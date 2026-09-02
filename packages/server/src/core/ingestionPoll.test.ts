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
function client(opts: { live: boolean; streamStatus?: string }) {
  const streams = vi.fn(async () => ({
    data: {
      items: [
        {
          id: "S1",
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
    contentDetails: { boundStreamId: "S1", enableAutoStart: true },
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

  it("spends nothing when no default key is set — there is no key to ask about", async () => {
    await store.update((s) => {
      s.defaults.defaultStreamBoundId = null;
    });
    const { yt, streams } = client({ live: true });
    await cacheFor(yt).refresh();
    expect(streams).not.toHaveBeenCalled();
    expect(store.get().cache.ingestion).toBeNull();
  });

  it("clears a reading about a key that is no longer the default, rather than showing it as current", async () => {
    const { yt } = client({ live: true });
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
