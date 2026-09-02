import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import type { youtube_v3 } from "googleapis";
import { JsonStore } from "../storage/jsonStore.js";
import { StateCache } from "./stateCache.js";
import { FAST_POLL_WINDOW_MS } from "./pollCadence.js";

/**
 * The ingestion reading rides the poll loop, and the only interesting thing about it is *when it
 * is allowed to spend a quota unit* — so these tests count `liveStreams.list` calls rather than
 * asserting the reading itself (that is `youtube/ingestion.test.ts`).
 */
function client(opts: { live: boolean; streamStatus?: string; boundStreamId?: string | null }) {
  const streams = vi.fn(async (params: { id?: string[] }) => ({
    data: {
      items: [
        {
          id: params.id?.[0] ?? "S1",
          snippet: { title: "Main key" },
          status: { streamStatus: opts.streamStatus ?? "active", healthStatus: { status: "good" } },
        },
      ],
    },
  }));
  const broadcast = {
    id: "B1",
    snippet: { title: "Tonight" },
    status: { privacyStatus: "public", lifeCycleStatus: opts.live ? "live" : "ready" },
    contentDetails: {
      boundStreamId: opts.boundStreamId === undefined ? "S1" : opts.boundStreamId,
      enableAutoStart: true,
    },
  };
  const yt = {
    liveBroadcasts: {
      list: vi.fn(async (params: { broadcastStatus?: string; id?: string[] }) => {
        if (params.id) return { data: { items: [broadcast] } };
        const wanted = params.broadcastStatus === "active" ? opts.live : !opts.live;
        return { data: { items: wanted ? [broadcast] : [] } };
      }),
    },
    liveStreams: { list: streams },
  } as unknown as youtube_v3.Youtube;
  return { yt, streams };
}

describe("ingestion reading on the poll loop (issue 059)", () => {
  let store: JsonStore;
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ingestion-poll-"));
    store = new JsonStore(path.join(dir, "store.json"));
    await store.init();
    await store.update((s) => {
      s.defaults.defaultStreamBoundId = "S1";
    });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const cacheFor = (yt: youtube_v3.Youtube) =>
    new StateCache(yt, store, { refreshIntervalMs: 60_000, healthFailureThreshold: 3 });

  it("reads ingestion while the broadcast is live — the moment the question is asked", async () => {
    const { yt, streams } = client({ live: true });
    await cacheFor(yt).refresh();
    expect(streams).toHaveBeenCalledTimes(1);
    const snap = store.get().cache.ingestion;
    expect(snap?.streamId).toBe("S1");
    expect(snap?.streamStatus).toBe("active");
  });

  it("reads ingestion while a latch is armed — the pre-show 'is it stuck on preparing' window", async () => {
    const { yt, streams } = client({ live: false });
    const cache = cacheFor(yt);
    await cache.setPendingMetadata({
      payload: { title: "Tonight" },
      targetId: "B0",
      capturedAt: new Date().toISOString(),
    });
    await cache.refresh();
    expect(streams).toHaveBeenCalledTimes(1);
    expect(store.get().cache.ingestion?.streamId).toBe("S1");
  });

  it("spends nothing while idle: no latch, not live, nobody watching", async () => {
    const { yt, streams } = client({ live: false });
    await cacheFor(yt).refresh();
    expect(streams).not.toHaveBeenCalled();
    expect(store.get().cache.ingestion).toBeNull();
  });

  it("spends nothing on a stale latch, the same window the fast probe stops at", async () => {
    const { yt, streams } = client({ live: false });
    const cache = cacheFor(yt);
    await cache.setPendingMetadata({
      payload: { title: "Yesterday" },
      targetId: "B0",
      capturedAt: new Date(Date.now() - FAST_POLL_WINDOW_MS - 1000).toISOString(),
    });
    await cache.refresh();
    expect(streams).not.toHaveBeenCalled();
  });

  it("spends nothing when there is no key to ask about at all", async () => {
    await store.update((s) => {
      s.defaults.defaultStreamBoundId = null;
    });
    const { yt, streams } = client({ live: true, boundStreamId: null });
    await cacheFor(yt).refresh();
    expect(streams).not.toHaveBeenCalled();
    expect(store.get().cache.ingestion).toBeNull();
  });

  it("reads the key the airing broadcast is bound to, not the one named as the default", async () => {
    // The mismatch willAir.ts models: the show is bound to a different key than Settings names.
    // Reporting on the default here answers a question nobody asked — green while nothing is
    // arriving for tonight, or red while the show is perfectly fine.
    const { yt, streams } = client({ live: true, boundStreamId: "BOUND" });
    await cacheFor(yt).refresh();
    expect(streams).toHaveBeenCalledWith(expect.objectContaining({ id: ["BOUND"] }));
    expect(store.get().cache.ingestion?.streamId).toBe("BOUND");
  });

  it("falls back to the default key when nothing is bound — the pre-show case", async () => {
    const { yt, streams } = client({ live: true, boundStreamId: null });
    await cacheFor(yt).refresh();
    expect(streams).toHaveBeenCalledWith(expect.objectContaining({ id: ["S1"] }));
  });

  it("clears a reading about a key that is no longer the one in play, rather than showing it as current", async () => {
    const { yt } = client({ live: true, boundStreamId: null });
    const cache = cacheFor(yt);
    await cache.writeCache({
      ingestion: {
        streamId: "OLD",
        streamTitle: "Old key",
        streamStatus: "active",
        healthStatus: "good",
        issues: [],
        checkedAt: new Date().toISOString(),
      },
    });
    await store.update((s) => {
      s.defaults.defaultStreamBoundId = null;
    });
    await cache.refresh();
    expect(store.get().cache.ingestion).toBeNull();
  });

  it("expires a reading the loop has stopped re-reading, so no key sits green all night", async () => {
    // The show ended: not live, no latch, so no unit is spent — and without expiry the last
    // reading taken before the credits rolled would stay "receiving" until morning.
    const { yt, streams } = client({ live: false, boundStreamId: null });
    const cache = cacheFor(yt);
    await cache.writeCache({
      ingestion: {
        streamId: "S1",
        streamTitle: "Main key",
        streamStatus: "active",
        healthStatus: "good",
        issues: [],
        checkedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      },
    });
    await cache.refresh();
    expect(streams).not.toHaveBeenCalled();
    expect(store.get().cache.ingestion).toBeNull();
  });

  it("keeps a manual check alive across the next idle tick — the operator paid for that answer", async () => {
    const { yt } = client({ live: false, boundStreamId: null });
    const cache = cacheFor(yt);
    await cache.writeCache({
      ingestion: {
        streamId: "S1",
        streamTitle: "Main key",
        streamStatus: "active",
        healthStatus: "good",
        issues: [],
        checkedAt: new Date().toISOString(),
      },
    });
    await cache.refresh();
    expect(store.get().cache.ingestion?.streamId).toBe("S1");
  });

  it("keeps a hung ingestion read out of health — it must not trip the refresh watchdog", async () => {
    // A socket that opens and never answers. The reading rides outside the 20s watchdog that
    // guards the refresh itself, so health stays on what the refresh's own calls proved.
    const { yt } = client({ live: true });
    (yt.liveStreams.list as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}),
    );
    const cache = cacheFor(yt);
    const done = await Promise.race([
      cache.refresh().then(() => "refreshed"),
      new Promise((r) => setTimeout(() => r("hung"), 200)),
    ]);
    expect(done).toBe("hung");
    // The refresh's own calls all landed, so health is green and the status is current.
    expect(store.get().cache.health).toBe("ok");
    expect(store.get().cache.status.title).toBe("Tonight");
  });

  it("keeps a failed ingestion read out of health — the refresh itself reached YouTube", async () => {
    const { yt } = client({ live: true });
    (yt.liveStreams.list as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("liveStreams blew up"),
    );
    await cacheFor(yt).refresh();
    expect(store.get().cache.health).toBe("ok");
    expect(store.get().cache.ingestion).toBeNull();
  });
});
