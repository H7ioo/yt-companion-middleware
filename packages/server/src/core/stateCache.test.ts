import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import type { youtube_v3 } from "googleapis";
import { JsonStore } from "../storage/jsonStore.js";
import { StateCache } from "./stateCache.js";
import { Logger } from "./logger.js";
import { AppError } from "./errors.js";
import {
  FAST_POLL_INTERVAL_MS,
  FAST_POLL_WINDOW_MS,
  FAST_PROBE_COST_UNITS,
} from "./pollCadence.js";
import { instrumentQuota, QUOTA_COST, QuotaTracker } from "./quota.js";

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

  it("keeps the latch when the runner was busy — no YouTube call was made", async () => {
    const cache = cacheFor({ active: [live("new-one", "Studio's title")] });
    cache.setReplayHandler(() => Promise.reject(new AppError("BUSY_TRY_AGAIN")));
    await arm("ghost");

    await cache.refresh();
    expect(store.get().cache.pendingMetadata?.targetId).toBe("ghost");
  });

  it("flags target drift when the edited broadcast changes while still idle", async () => {
    // Drift is a change observed *while running*, so the cache has to see "first" for itself
    // before a switch to "second" means anything.
    const broadcasts: Record<string, youtube_v3.Schema$LiveBroadcast[]> = {
      upcoming: [upcoming("first", "tonight")],
    };
    const cache = cacheFor(broadcasts);
    await cache.refresh();
    broadcasts.upcoming = [upcoming("second", "another")];

    await cache.refresh();
    expect(store.get().cache.targetConflict?.code).toBe("TARGET_DRIFT");
  });

  it("does not call a target id left over from a previous run 'drift'", async () => {
    // lastTargetId is persisted, so after a restart it names last session's target. Comparing
    // against it raised a drift banner for a whole refresh interval — usually during setup.
    const cache = cacheFor({ upcoming: [upcoming("tonight", "tonight")] });
    await store.update((s) => {
      s.cache.lastTargetId = "yesterdays-show";
      s.cache.status = { title: "x", privacyStatus: "public", isLive: false, noTarget: false };
    });

    await cache.refresh();
    expect(store.get().cache.targetConflict).toBeNull();
    expect(store.get().cache.lastTargetId).toBe("tonight");
  });

  it("does not call the auto-start mint 'drift' — that is the show starting (PRD-12 §2)", async () => {
    const broadcasts: Record<string, youtube_v3.Schema$LiveBroadcast[]> = {
      upcoming: [upcoming("the-one-we-edited", "tonight")],
    };
    const cache = cacheFor(broadcasts);
    await cache.refresh();
    broadcasts.upcoming = [mintedNow("minted", "tonight")];

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
    const broadcasts: Record<string, youtube_v3.Schema$LiveBroadcast[]> = {
      active: [live("the-show-that-just-ended", "on air")],
    };
    const cache = cacheFor(broadcasts);
    await cache.refresh();
    broadcasts.active = [];
    broadcasts.upcoming = [upcoming("next", "next show")];

    await cache.refresh();
    expect(store.get().cache.targetConflict).toBeNull();
  });

  it("does not overwrite a newer latch when re-arming after a busy replay", async () => {
    // The replay was rejected before touching YouTube, so the latch is re-armed — but an action
    // that ran meanwhile has latched the operator's current intent, and that one wins.
    const cache = cacheFor({ active: [live("new-one", "Studio's title")] });
    cache.setReplayHandler(async () => {
      await store.update((s) => {
        s.cache.pendingMetadata = { payload: { title: "Newer" }, targetId: "ghost-2", capturedAt: new Date().toISOString() };
      });
      throw new AppError("BUSY_TRY_AGAIN");
    });
    await arm("ghost");

    await cache.refresh();
    expect(store.get().cache.pendingMetadata?.payload.title).toBe("Newer");
  });
});

describe("StateCache refresh scheduling", () => {
  let store: JsonStore;
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cache-refresh-"));
    store = new JsonStore(path.join(dir, "store.json"));
    await store.init();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("gives up on a request that never answers instead of wedging every later refresh", async () => {
    vi.useFakeTimers();
    // googleapis has no request timeout: a half-open socket leaves the promise pending forever,
    // and with refreshes deduped onto the in-flight run that would freeze health on stale state.
    const cache = new StateCache(
      { liveBroadcasts: { list: () => new Promise(() => {}) } } as unknown as youtube_v3.Youtube,
      store,
      { refreshIntervalMs: 60_000, healthFailureThreshold: 1 },
    );

    const hung = cache.refresh();
    await vi.advanceTimersByTimeAsync(25_000);
    await hung;

    expect(store.get().cache.health).not.toBe("ok");
    // The slot is free again, so the next refresh actually runs.
    expect(store.get().cache.healthMessage).toMatch(/did not respond/i);
  });

  it("forces a fresh look rather than answering Re-check from a read that predates the fix", async () => {
    let calls = 0;
    let release: (() => void) | null = null;
    const cache = new StateCache(
      {
        liveBroadcasts: {
          list: async (p: youtube_v3.Params$Resource$Livebroadcasts$List) => {
            if (p.broadcastStatus === "active") {
              calls += 1;
              if (calls === 1) await new Promise<void>((r) => (release = r));
            }
            return { data: { items: [] } };
          },
        },
      } as unknown as youtube_v3.Youtube,
      store,
      { refreshIntervalMs: 60_000, healthFailureThreshold: 3 },
    );

    const first = cache.refresh();
    const forced = cache.refresh({ force: true });
    release!();
    await Promise.all([first, forced]);

    expect(calls).toBeGreaterThan(1);
  });

  it("still shares the in-flight run with an unforced caller", async () => {
    // Count the "active" query only — resolveTarget makes three list calls per refresh.
    let calls = 0;
    const cache = new StateCache(
      {
        liveBroadcasts: {
          list: async (p: youtube_v3.Params$Resource$Livebroadcasts$List) => {
            if (p.broadcastStatus === "active") calls += 1;
            return { data: { items: [] } };
          },
        },
      } as unknown as youtube_v3.Youtube,
      store,
      { refreshIntervalMs: 60_000, healthFailureThreshold: 3 },
    );

    await Promise.all([cache.refresh(), cache.refresh()]);
    expect(calls).toBe(1);
  });
});

/**
 * The active preset describes what is on air, so it has to survive only as long as that is true.
 * Every in-app route clears it explicitly; an edit made in YouTube Studio reaches none of them,
 * and left the Companion key lit on a preset that was no longer applied.
 */
describe("StateCache active-preset reconciliation", () => {
  let store: JsonStore;
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cache-active-preset-"));
    store = new JsonStore(path.join(dir, "store.json"));
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function cacheFor(broadcasts: Record<string, youtube_v3.Schema$LiveBroadcast[]>) {
    return new StateCache(clientWith(broadcasts), store, {
      refreshIntervalMs: 60_000,
      healthFailureThreshold: 3,
    });
  }

  it("keeps the active preset while YouTube still holds the title it wrote", async () => {
    const cache = cacheFor({ active: [live("bc1", "Jumu'ah")] });
    await cache.setActivePreset("p1", "Jumu'ah");

    await cache.refresh();

    expect(store.get().cache.activePresetId).toBe("p1");
  });

  it("drops the active preset when the title was changed in YouTube Studio", async () => {
    const cache = cacheFor({ active: [live("bc1", "Jumu'ah")] });
    await cache.setActivePreset("p1", "Jumu'ah");

    await cache.refresh(); // still matching
    // The operator retitles the same broadcast from Studio; the next poll sees the new title.
    const edited = cacheFor({ active: [live("bc1", "Edited in Studio")] });
    await edited.refresh();

    expect(store.get().cache.activePresetId).toBeNull();
    expect(store.get().cache.activePresetTitle).toBeNull();
  });

  it("drops the active preset when the channel has no broadcast at all", async () => {
    await cacheFor({}).setActivePreset("p1", "Jumu'ah");

    await cacheFor({}).refresh();

    expect(store.get().cache.activePresetId).toBeNull();
  });

  it("leaves a pre-upgrade active preset alone (no recorded title to compare)", async () => {
    // A store written before activePresetTitle existed defaults it to null — reconciling on that
    // would clear a preset that may well still be on air.
    await store.update((s) => {
      s.cache.activePresetId = "p1";
      s.cache.activePresetTitle = null;
    });

    await cacheFor({ active: [live("bc1", "Anything")] }).refresh();

    expect(store.get().cache.activePresetId).toBe("p1");
  });

  it("keeps the active preset when YouTube trimmed the title it stored", async () => {
    // YouTube normalizes what it stores; the preset is still what is on air, and treating the
    // difference as an outside edit would drop the highlight on every single poll.
    const cache = cacheFor({ active: [live("bc1", "Jumu'ah")] });
    await cache.setActivePreset("p1", "Jumu'ah ");

    await cache.refresh();

    expect(store.get().cache.activePresetId).toBe("p1");
  });

  it("keeps the active preset a replay is about to re-apply to the new broadcast", async () => {
    // The go-live case (PRD-12 §2): the operator applied a preset while idle, YouTube minted a
    // different broadcast, and this refresh reads its default title. The replay puts the preset's
    // metadata on air moments later, so the title read here is no reason to clear it.
    const cache = cacheFor({ active: [live("new-one", "Live stream")] });
    cache.setReplayHandler(async () => undefined);
    await cache.setActivePreset("p1", "Jumu'ah");
    await store.update((s) => {
      s.cache.pendingMetadata = {
        payload: { title: "Jumu'ah" },
        targetId: "ghost-we-edited",
        capturedAt: new Date().toISOString(),
      };
    });

    await cache.refresh();

    expect(store.get().cache.activePresetId).toBe("p1");
  });

  it("keeps the active preset through the pre-live mint window", async () => {
    // The same go-live case one poll earlier: YouTube has minted the broadcast that will air but
    // it is not live yet, so the replay cannot fire and the eligibility guard does not bite. The
    // title read is YouTube's placeholder on a broadcast the preset never wrote to — clearing on
    // it darks the key permanently, because the replay that follows never re-lights it.
    const cache = cacheFor({ upcoming: [mintedNow("new-one", "Live stream")] });
    cache.setReplayHandler(async () => undefined);
    await cache.setActivePreset("p1", "Jumu'ah", "ghost-we-edited");
    await store.update((s) => {
      s.cache.pendingMetadata = {
        payload: { title: "Jumu'ah" },
        targetId: "ghost-we-edited",
        capturedAt: new Date().toISOString(),
      };
    });

    await cache.refresh();

    expect(store.get().cache.activePresetId).toBe("p1");
  });

  it("keeps the active preset when the broadcast list is momentarily empty", async () => {
    // The upcoming -> active handover can answer with nothing at all for a poll. The preset was
    // written to a broadcast that still exists; a list that cannot see it is not evidence the
    // preset came off air.
    await cacheFor({}).setActivePreset("p1", "Jumu'ah", "bc1");

    await cacheFor({}).refresh();

    expect(store.get().cache.activePresetId).toBe("p1");
    expect(store.get().cache.activePresetTitle).toBe("Jumu'ah");
  });

  it("re-points the active preset at the broadcast a replay landed on", async () => {
    // Once the replay has put the preset's metadata on the new broadcast, that broadcast is the
    // one to reconcile against — otherwise the preset names a stale id and never drops again.
    const cache = cacheFor({ active: [live("new-one", "Live stream")] });
    cache.setReplayHandler(async () => ({}));
    await cache.setActivePreset("p1", "Jumu'ah", "ghost-we-edited");
    await store.update((s) => {
      s.cache.pendingMetadata = {
        payload: { title: "Jumu'ah" },
        targetId: "ghost-we-edited",
        capturedAt: new Date().toISOString(),
      };
    });

    await cache.refresh();
    expect(store.get().cache.activePresetTargetId).toBe("new-one");

    // And an outside edit to that broadcast now drops the preset, as it always did.
    await cacheFor({ active: [live("new-one", "Edited in Studio")] }).refresh();
    expect(store.get().cache.activePresetId).toBeNull();
  });

  it("drops the active preset when the replayed metadata is not what the preset wrote", async () => {
    // The latch carried a later ad-hoc edit, so what is on air after the replay is not the preset.
    const cache = cacheFor({ active: [live("new-one", "Live stream")] });
    cache.setReplayHandler(async () => ({}));
    await cache.setActivePreset("p1", "Jumu'ah", "ghost-we-edited");
    await store.update((s) => {
      s.cache.pendingMetadata = {
        payload: { title: "Something else entirely" },
        targetId: "ghost-we-edited",
        capturedAt: new Date().toISOString(),
      };
    });

    await cache.refresh();

    expect(store.get().cache.activePresetId).toBeNull();
    expect(store.get().cache.activePresetTargetId).toBeNull();
  });

  it("keeps a preset applied while a refresh was already in flight", async () => {
    // That refresh is carrying the title from before the press. Clearing on it would dark the key
    // the operator just lit, and nothing later puts it back.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowClient = {
      liveBroadcasts: {
        list: async () => {
          await gate;
          return { data: { items: [live("bc1", "Title from before the press")] } };
        },
      },
    } as unknown as youtube_v3.Youtube;
    const cache = new StateCache(slowClient, store, {
      refreshIntervalMs: 60_000,
      healthFailureThreshold: 3,
    });

    const inFlight = cache.refresh();
    await cache.setActivePreset("p1", "Jumu'ah");
    release();
    await inFlight;

    expect(store.get().cache.activePresetId).toBe("p1");
    expect(store.get().cache.activePresetTitle).toBe("Jumu'ah");
  });
});

/**
 * PRD-14: while a latch is armed and the channel is idle, a poll tick asks one cheap question —
 * has anything started — instead of re-resolving the whole target. Everything else keeps today's
 * behaviour exactly, including the cost.
 */
describe("StateCache fast probe while armed (issue 054 / PRD-14)", () => {
  let store: JsonStore;
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cache-probe-"));
    store = new JsonStore(path.join(dir, "store.json"));
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** Records every `liveBroadcasts.list` call so a tick's exact cost can be asserted. */
  function countingClient(broadcasts: Record<string, youtube_v3.Schema$LiveBroadcast[]>) {
    const calls: youtube_v3.Params$Resource$Livebroadcasts$List[] = [];
    const inner = clientWith(broadcasts);
    const unused = async () => ({ data: {} });
    const yt = {
      // update/bind/videos are never called here, but instrumentQuota patches them, so the stub
      // has to carry the same surface as the real client.
      liveBroadcasts: {
        list: (params: youtube_v3.Params$Resource$Livebroadcasts$List) => {
          calls.push(params);
          return inner.liveBroadcasts.list(params);
        },
        update: unused,
        bind: unused,
      },
      videos: { list: unused, update: unused },
    } as unknown as youtube_v3.Youtube;
    return { yt, calls };
  }

  function cacheFor(yt: youtube_v3.Youtube) {
    return new StateCache(yt, store, { refreshIntervalMs: 60_000, healthFailureThreshold: 3 });
  }

  /** Arms a latch pointing at `targetId`, captured `agoMs` in the past. */
  async function arm(cache: StateCache, targetId: string, agoMs: number) {
    await cache.setPendingMetadata({
      payload: { title: "Tonight's show" },
      targetId,
      capturedAt: new Date(Date.now() - agoMs).toISOString(),
    });
  }

  it("costs exactly what it costs today on an idle channel with no latch", async () => {
    const { yt, calls } = countingClient({ upcoming: [upcoming("bc1", "Later tonight")] });
    const cache = cacheFor(yt);

    await cache.pollOnce();
    const withProbe = calls.length;
    calls.length = 0;
    await cache.refresh();

    expect(withProbe).toBe(calls.length);
  });

  it("asks one cheap question while armed, instead of re-resolving the target", async () => {
    const { yt, calls } = countingClient({ upcoming: [upcoming("bc1", "Later tonight")] });
    const cache = cacheFor(yt);
    await arm(cache, "bc1", 60_000);

    await cache.pollOnce();

    expect(calls).toHaveLength(1);
    expect(calls[0].broadcastStatus).toBe("active");
    expect(cache.nextPollIntervalMs()).toBe(FAST_POLL_INTERVAL_MS);
  });

  it("hands off to the full refresh the moment the probe sees something on air", async () => {
    const { yt, calls } = countingClient({ active: [live("the-one-that-aired", "Studio's title")] });
    const cache = cacheFor(yt);
    const replayed: unknown[] = [];
    cache.setReplayHandler(async (p) => void replayed.push(p));
    await arm(cache, "ghost-we-edited", 60_000);

    await cache.pollOnce();

    // The probe answered "yes", so the refresh ran behind it — more than the probe's one call.
    expect(calls.length).toBeGreaterThan(1);
    expect(replayed).toHaveLength(1);
    expect(store.get().cache.pendingMetadata).toBeNull();
  });

  it("still replays on the normal interval once the fast window has expired", async () => {
    // Arming early must never be worse than arming late: past the window the latch stays armed
    // and the ordinary poll lands it, which is today's behaviour.
    const { yt } = countingClient({ active: [live("the-one-that-aired", "Studio's title")] });
    const cache = cacheFor(yt);
    const replayed: unknown[] = [];
    cache.setReplayHandler(async (p) => void replayed.push(p));
    await arm(cache, "ghost-we-edited", FAST_POLL_WINDOW_MS + 60_000);

    expect(cache.nextPollIntervalMs()).toBe(60_000);
    await cache.pollOnce();

    expect(replayed).toHaveLength(1);
  });

  it("issues no probe at all with the API switched off", async () => {
    const { yt, calls } = countingClient({ upcoming: [upcoming("bc1", "Later tonight")] });
    const cache = cacheFor(yt);
    await arm(cache, "bc1", 60_000);
    await store.update((st) => {
      st.service.apiEnabled = false;
    });

    await cache.pollOnce();

    expect(calls).toHaveLength(0);
  });

  it("counts probes in the day's quota rather than hiding them", async () => {
    // A jump in units on a show day has to have an explanation on the readout.
    const { yt } = countingClient({ upcoming: [upcoming("bc1", "Later tonight")] });
    const tracker = new QuotaTracker(store, 10_000);
    tracker.init();
    const cache = cacheFor(instrumentQuota(yt, tracker));
    await arm(cache, "bc1", 60_000);

    await cache.pollOnce();

    expect(tracker.snapshot().used).toBe(QUOTA_COST.read * FAST_PROBE_COST_UNITS);
  });
});
