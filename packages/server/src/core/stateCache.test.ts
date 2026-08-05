import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import type { youtube_v3 } from "googleapis";
import { JsonStore } from "../storage/jsonStore.js";
import { StateCache } from "./stateCache.js";
import { Logger } from "./logger.js";

/** A YouTube client whose broadcast list rejects with `err`, to drive the failure path. */
function failingClient(err: unknown): youtube_v3.Youtube {
  return {
    liveBroadcasts: { list: () => Promise.reject(err) },
  } as unknown as youtube_v3.Youtube;
}

describe("StateCache activity logging (issue 018 / PRD-06 §3)", () => {
  let store: JsonStore;
  let dir: string;
  let logger: Logger;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cache-log-"));
    store = new JsonStore(path.join(dir, "store.json"));
    await store.init();
    logger = new Logger();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("logs a network-classified failure so it appears in the panel", async () => {
    const cache = new StateCache(
      failingClient({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" }),
      store,
      { refreshIntervalMs: 60_000, healthFailureThreshold: 3 },
      undefined,
      logger,
    );
    await cache.refresh();

    const [entry] = logger.list();
    expect(entry.category).toBe("network");
    expect(entry.level).toBe("error");
    expect(entry.code).toBe("NETWORK_ERROR");
  });

  it("logs a recovery once the connection comes back healthy", async () => {
    // A client that fails first, then returns an idle (no-target) channel — a healthy state.
    let down = true;
    const flakyClient = {
      liveBroadcasts: {
        list: () =>
          down
            ? Promise.reject({ code: "ECONNREFUSED", message: "down" })
            : Promise.resolve({ data: { items: [] } }),
      },
    } as unknown as youtube_v3.Youtube;

    const cache = new StateCache(
      flakyClient,
      store,
      { refreshIntervalMs: 60_000, healthFailureThreshold: 3 },
      undefined,
      logger,
    );
    await cache.refresh(); // fails -> degraded, logs a network error
    logger.clear();
    down = false;
    await cache.refresh(); // recovers -> ok

    const [entry] = logger.list();
    expect(entry.category).toBe("system");
    expect(entry.level).toBe("info");
    expect(entry.message).toMatch(/recover/i);
  });

  it("does not log a recovery when refresh was already healthy", async () => {
    const cache = new StateCache(
      { liveBroadcasts: { list: () => Promise.resolve({ data: { items: [] } }) } } as unknown as youtube_v3.Youtube,
      store,
      { refreshIntervalMs: 60_000, healthFailureThreshold: 3 },
      undefined,
      logger,
    );
    await cache.refresh();
    expect(logger.list()).toHaveLength(0);
  });
});

/**
 * A client that reports a fixed set of broadcasts, so a refresh can be pointed at an idle
 * channel, a live one, or a channel whose live broadcast is not the one we last edited.
 */
function clientWith(broadcasts: Record<string, youtube_v3.Schema$LiveBroadcast[]>) {
  return {
    liveBroadcasts: {
      list: async (params: youtube_v3.Params$Resource$Livebroadcasts$List) => {
        if (params.id) {
          const all = Object.values(broadcasts).flat();
          return { data: { items: all.filter((b) => params.id!.includes(b.id!)) } };
        }
        if (params.broadcastStatus === "active") return { data: { items: broadcasts.active ?? [] } };
        if (params.broadcastStatus === "upcoming")
          return { data: { items: broadcasts.upcoming ?? [] } };
        return { data: { items: [] } };
      },
    },
  } as unknown as youtube_v3.Youtube;
}

const live = (id: string, title: string) => ({
  id,
  snippet: { title },
  status: { lifeCycleStatus: "live", privacyStatus: "public" },
});
/** A scheduled show later tonight — not the broadcast YouTube mints as an auto-start begins. */
const upcoming = (id: string, title: string) => ({
  id,
  snippet: {
    title,
    scheduledStartTime: new Date(Date.now() + 2 * 3600_000).toISOString(),
    publishedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
  status: { lifeCycleStatus: "ready", privacyStatus: "public" },
});

/** The broadcast YouTube creates moments before an auto-start session goes to air (PRD-12 §2). */
const mintedNow = (id: string, title: string) => ({
  id,
  snippet: {
    title,
    scheduledStartTime: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
  },
  status: { lifeCycleStatus: "ready", privacyStatus: "public" },
});

/**
 * The go-live fix (PRD-12 §2). With an auto-start encoder, YouTube mints the broadcast that
 * airs about a minute before air — so a title set beforehand lands on a broadcast that never
 * goes live. The cache spots the mismatch and replays the intent onto the real one.
 */
describe("StateCache pending-metadata replay", () => {
  let store: JsonStore;
  let dir: string;
  let logger: Logger;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cache-replay-"));
    store = new JsonStore(path.join(dir, "store.json"));
    await store.init();
    logger = new Logger();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const arm = (targetId: string, capturedAt = new Date().toISOString()) =>
    store.update((s) => {
      s.cache.pendingMetadata = { payload: { title: "Tonight" }, targetId, capturedAt };
    });

  function cacheFor(broadcasts: Record<string, youtube_v3.Schema$LiveBroadcast[]>) {
    return new StateCache(
      clientWith(broadcasts),
      store,
      { refreshIntervalMs: 60_000, healthFailureThreshold: 3 },
      undefined,
      logger,
    );
  }

  it("replays onto the broadcast that actually went live", async () => {
    const cache = cacheFor({ active: [live("new-one", "Studio's title")] });
    const replayed: unknown[] = [];
    cache.setReplayHandler(async (p) => void replayed.push(p));
    await arm("ghost-we-edited");

    await cache.refresh();

    expect(replayed).toHaveLength(1);
    expect(store.get().cache.pendingMetadata).toBeNull();
    expect(logger.list()[0].message).toMatch(/re-applied your metadata/i);
  });

  it("does not replay when the live broadcast is the one we already edited", async () => {
    const cache = cacheFor({ active: [live("same-one", "Tonight")] });
    const replayed: unknown[] = [];
    cache.setReplayHandler(async (p) => void replayed.push(p));
    await arm("same-one");

    await cache.refresh();
    expect(replayed).toHaveLength(0);
  });

  it("disarms once the broadcast we edited airs, so the next show can't inherit its title", async () => {
    // Caught in a live test on 2026-08-05: the intent was satisfied but the latch stayed primed,
    // leaving this show's title queued for whatever went live next inside the TTL.
    const cache = cacheFor({ active: [live("same-one", "Tonight")] });
    cache.setReplayHandler(async () => {});
    await arm("same-one");

    await cache.refresh();
    expect(store.get().cache.pendingMetadata).toBeNull();
  });

  it("does not replay while still idle — nothing has gone live yet", async () => {
    const cache = cacheFor({ upcoming: [upcoming("up-1", "waiting")] });
    const replayed: unknown[] = [];
    cache.setReplayHandler(async (p) => void replayed.push(p));
    await arm("ghost");

    await cache.refresh();
    expect(replayed).toHaveLength(0);
    expect(store.get().cache.pendingMetadata).not.toBeNull();
  });

  it("drops a stale latch instead of putting yesterday's title on tonight's show", async () => {
    const cache = cacheFor({ active: [live("new-one", "Studio's title")] });
    const replayed: unknown[] = [];
    cache.setReplayHandler(async (p) => void replayed.push(p));
    await arm("ghost", new Date(Date.now() - 7 * 3600_000).toISOString());

    await cache.refresh();
    expect(replayed).toHaveLength(0);
    expect(store.get().cache.pendingMetadata).toBeNull();
  });

  it("clears the latch and logs when the replay itself fails, so it cannot re-fire all show", async () => {
    const cache = cacheFor({ active: [live("new-one", "Studio's title")] });
    cache.setReplayHandler(() => Promise.reject(new Error("YouTube said no")));
    await arm("ghost");

    await cache.refresh();
    expect(store.get().cache.pendingMetadata).toBeNull();
    expect(logger.list()[0].message).toMatch(/could not re-apply/i);
  });

  it("flags target drift when the edited broadcast changes while still idle", async () => {
    const cache = cacheFor({ upcoming: [upcoming("second", "another")] });
    await store.update((s) => {
      s.cache.lastTargetId = "first";
      s.cache.status = { title: "x", privacyStatus: "public", isLive: false, noTarget: false };
    });

    await cache.refresh();
    expect(store.get().cache.targetConflict?.code).toBe("TARGET_DRIFT");
  });

  it("does not call the auto-start mint 'drift' — that is the show starting (PRD-12 §2)", async () => {
    const cache = cacheFor({ upcoming: [mintedNow("minted", "tonight")] });
    await store.update((s) => {
      s.cache.lastTargetId = "the-one-we-edited";
      s.cache.status = { title: "x", privacyStatus: "public", isLive: false, noTarget: false };
    });

    await cache.refresh();
    expect(store.get().cache.targetConflict).toBeNull();
  });

  it("forgets the conflict and the target id once the channel has no target at all", async () => {
    const cache = cacheFor({});
    await store.update((s) => {
      s.cache.lastTargetId = "gone";
      s.cache.targetConflict = { code: "TARGET_DRIFT", message: "drifted", ids: ["a", "b"] };
    });

    await cache.refresh();
    expect(store.get().cache.targetConflict).toBeNull();
    expect(store.get().cache.lastTargetId).toBeNull();
    expect(store.get().cache.status.noTarget).toBe(true);
  });

  it("replays once when the timer and a manual refresh overlap", async () => {
    const cache = cacheFor({ active: [live("new-one", "Studio's title")] });
    const replayed: unknown[] = [];
    cache.setReplayHandler(async (p) => void replayed.push(p));
    await arm("ghost-we-edited");

    await Promise.all([cache.refresh(), cache.refresh()]);
    expect(replayed).toHaveLength(1);
  });

  it("does not call a show ending 'drift' — a new target after live is expected", async () => {
    const cache = cacheFor({ upcoming: [upcoming("next", "next show")] });
    await store.update((s) => {
      s.cache.lastTargetId = "the-show-that-just-ended";
      s.cache.status = { title: "x", privacyStatus: "public", isLive: true, noTarget: false };
    });

    await cache.refresh();
    expect(store.get().cache.targetConflict).toBeNull();
  });
});
