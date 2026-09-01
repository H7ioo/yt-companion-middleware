import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { youtube_v3 } from "googleapis";
import { broadcastsRouter } from "./broadcasts.js";
import type { AppContext } from "./context.js";

interface Fake {
  /** Every liveBroadcasts.list query the route made, in order. */
  calls: youtube_v3.Params$Resource$Livebroadcasts$List[];
  units: number;
}

/**
 * A fake channel with more upcoming broadcasts than fit on one page. The default page size of 5
 * is what hid the real target in the original bug, so the route must walk the pages.
 */
function fakeYt(fake: Fake, upcoming: youtube_v3.Schema$LiveBroadcast[], streams: youtube_v3.Schema$LiveStream[]) {
  return {
    liveBroadcasts: {
      list: async (params: youtube_v3.Params$Resource$Livebroadcasts$List) => {
        fake.calls.push(params);
        fake.units += 1;
        if (params.broadcastStatus !== "upcoming") return { data: { items: [] } };
        const size = params.maxResults ?? 5;
        const start = params.pageToken ? Number(params.pageToken) : 0;
        const items = upcoming.slice(start, start + size);
        const next = start + size < upcoming.length ? String(start + size) : undefined;
        return { data: { items, nextPageToken: next } };
      },
    },
    liveStreams: {
      list: async () => {
        fake.units += 1;
        return { data: { items: streams } };
      },
    },
  } as unknown as youtube_v3.Youtube;
}

async function mount(ctx: Partial<AppContext>) {
  const app = express();
  app.use(express.json());
  app.use("/api/dashboard/broadcasts", broadcastsRouter(ctx as AppContext));
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/api/dashboard/broadcasts`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("GET /api/dashboard/broadcasts", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });

  it("walks past the first page, so a target beyond the default 5 is still found", async () => {
    // Six strays and then the real one — off page 1 under YouTube's default page size.
    const upcoming: youtube_v3.Schema$LiveBroadcast[] = [
      ...Array.from({ length: 60 }, (_, i) => ({
        id: `stray-${i}`,
        snippet: { title: `stray ${i}` },
        contentDetails: {},
      })),
      {
        id: "tonight",
        snippet: { title: "tonight's show" },
        contentDetails: { boundStreamId: "stream-A", enableAutoStart: true },
      },
    ];
    const fake: Fake = { calls: [], units: 0 };
    const yt = fakeYt(fake, upcoming, [{ id: "stream-A", snippet: { title: "OBS key" } }]);
    const m = await mount({
      yt,
      store: { get: () => ({ defaults: { defaultStreamBoundId: "stream-A" } }) },
      quota: { snapshot: () => ({ used: fake.units }) },
    } as unknown as Partial<AppContext>);
    close = m.close;

    const res = await fetch(m.url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ id: string; willAir: boolean }>;
      quotaUnits: number;
    };
    expect(body.entries.filter((e) => e.willAir).map((e) => e.id)).toEqual(["tonight"]);
    expect(fake.calls.every((c) => c.maxResults === 50)).toBe(true);
    // Measured, not assumed: two broadcast pages for upcoming, one for active, one stream read.
    expect(body.quotaUnits).toBe(fake.units);
    expect(body.quotaUnits).toBe(4);
  });
});
