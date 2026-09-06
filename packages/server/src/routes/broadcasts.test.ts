import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { youtube_v3 } from "googleapis";
import { broadcastsRouter } from "./broadcasts.js";
import type { AppContext } from "./context.js";
import type { BroadcastEditView } from "@app/shared";

interface Fake {
  /** Every liveBroadcasts.list query the route made, in order. */
  calls: youtube_v3.Params$Resource$Livebroadcasts$List[];
  /** Every liveStreams.list query, in order — the key list is paged too. */
  streamCalls: youtube_v3.Params$Resource$Livestreams$List[];
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
      list: async (params: youtube_v3.Params$Resource$Livestreams$List) => {
        fake.streamCalls.push(params);
        fake.units += 1;
        const size = params.maxResults ?? 5;
        const start = params.pageToken ? Number(params.pageToken) : 0;
        const items = streams.slice(start, start + size);
        const next = start + size < streams.length ? String(start + size) : undefined;
        return { data: { items, nextPageToken: next } };
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
    const fake: Fake = { calls: [], streamCalls: [], units: 0 };
    const yt = fakeYt(fake, upcoming, [{ id: "stream-A", snippet: { title: "OBS key" } }]);
    const m = await mount({
      yt,
      store: {
        get: () => ({
          preparedBroadcasts: [],
          defaults: { defaultStreamBoundId: "stream-A" },
          service: { apiEnabled: true },
        }),
      },
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
    // Counted from this request's own calls: two broadcast pages for upcoming, one for active,
    // one stream read — and equal to what the fake channel actually served.
    expect(body.quotaUnits).toBe(fake.units);
    expect(body.quotaUnits).toBe(4);
  });

  it("walks the ingestion keys too, so the key count it states is the real one", async () => {
    // Seven keys: under YouTube's default page size of 5 the verdict used to state "5 ingestion
    // keys" as fact, and name the keys past page 1 by raw id.
    const streams = Array.from({ length: 7 }, (_, i) => ({
      id: `stream-${i}`,
      snippet: { title: `key ${i}` },
    }));
    const fake: Fake = { calls: [], streamCalls: [], units: 0 };
    const yt = fakeYt(fake, [], streams);
    const m = await mount({
      yt,
      store: {
        get: () => ({
          preparedBroadcasts: [],
          defaults: { defaultStreamBoundId: null },
          service: { apiEnabled: true },
        }),
      },
      quota: { snapshot: () => ({ used: fake.units }) },
    } as unknown as Partial<AppContext>);
    close = m.close;

    const body = (await (await fetch(m.url)).json()) as { verdict: string };
    expect(fake.streamCalls.every((c) => c.maxResults === 50)).toBe(true);
    expect(body.verdict).toContain("This channel has 7 ingestion keys");
  });

  it("spends nothing while the YouTube API is paused, however the call arrives", async () => {
    // The panel hides itself when the switch is off; this is the half that holds for a stale tab.
    const fake: Fake = { calls: [], streamCalls: [], units: 0 };
    const m = await mount({
      yt: fakeYt(fake, [], []),
      store: {
        get: () => ({
          preparedBroadcasts: [],
          defaults: { defaultStreamBoundId: null },
          service: { apiEnabled: false },
        }),
      },
      quota: { snapshot: () => ({ used: 0 }) },
    } as unknown as Partial<AppContext>);
    close = m.close;

    const res = await fetch(m.url);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "SERVICE_DISABLED",
    );
    expect(fake.units).toBe(0);
  });
});

/**
 * Changing a broadcast that already exists (issue 070). The route's whole job is to be the one
 * place an edit happens: a read, the merge, and `writeBroadcast` — never a bare update.
 */
describe("PATCH /api/dashboard/broadcasts/:id", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });

  interface Edited {
    updates: youtube_v3.Schema$LiveBroadcast[];
    binds: youtube_v3.Params$Resource$Livebroadcasts$Bind[];
    videoUpdates: youtube_v3.Schema$Video[];
  }

  function editableYt(edited: Edited, resource: youtube_v3.Schema$LiveBroadcast) {
    return {
      liveBroadcasts: {
        list: async () => ({ data: { items: [resource] } }),
        update: async (params: youtube_v3.Params$Resource$Livebroadcasts$Update) => {
          edited.updates.push(params.requestBody as youtube_v3.Schema$LiveBroadcast);
          return { data: params.requestBody };
        },
        bind: async (params: youtube_v3.Params$Resource$Livebroadcasts$Bind) => {
          edited.binds.push(params);
          return { data: {} };
        },
      },
      videos: {
        list: async () => ({ data: { items: [{ snippet: { title: "Sunday service", categoryId: "22" } }] } }),
        update: async (params: youtube_v3.Params$Resource$Videos$Update) => {
          edited.videoUpdates.push(params.requestBody as youtube_v3.Schema$Video);
          return { data: params.requestBody };
        },
      },
    } as unknown as youtube_v3.Youtube;
  }

  function ctxFor(yt: youtube_v3.Youtube): Partial<AppContext> {
    return {
      yt,
      store: {
        get: () => ({ service: { apiEnabled: true }, preparedBroadcasts: [] }),
        update: async () => {},
      } as unknown as AppContext["store"],
      logger: { push: () => {} } as unknown as AppContext["logger"],
      cache: { refresh: async () => {} } as unknown as AppContext["cache"],
    };
  }

  it("changes the one field asked for and re-sends the rest", async () => {
    const edited: Edited = { updates: [], binds: [], videoUpdates: [] };
    const yt = editableYt(edited, {
      id: "b1",
      snippet: { title: "Sunday service", description: "the usual", scheduledStartTime: "2026-09-06T18:00:00Z" },
      status: { privacyStatus: "public", lifeCycleStatus: "ready" },
      contentDetails: { boundStreamId: "s1", enableAutoStart: true, enableDvr: true },
    });
    const m = await mount(ctxFor(yt));
    close = m.close;

    const res = await fetch(`${m.url}/b1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Harvest service" }),
    });

    expect(res.status).toBe(200);
    expect(edited.updates).toHaveLength(1);
    const sent = edited.updates[0];
    expect(sent.snippet?.title).toBe("Harvest service");
    // The rest of the resource rode along: `update` is a PUT, and anything omitted is deleted.
    expect(sent.snippet?.description).toBe("the usual");
    expect(sent.contentDetails?.enableDvr).toBe(true);
    // One read plus one write, stated so the form can say what a press costs before it happens.
    expect(((await res.json()) as { quotaUnits: number }).quotaUnits).toBe(51);
  });

  it("refuses a contentDetails flag once the broadcast is on air, naming the field and the state", async () => {
    const edited: Edited = { updates: [], binds: [], videoUpdates: [] };
    const yt = editableYt(edited, {
      id: "b1",
      snippet: { title: "Sunday service", description: "the usual" },
      status: { privacyStatus: "public", lifeCycleStatus: "live" },
      contentDetails: { boundStreamId: "s1", enableAutoStart: true },
    });
    const m = await mount(ctxFor(yt));
    close = m.close;

    const res = await fetch(`${m.url}/b1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enableDvr: false }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BROADCAST_STATE_LOCKED");
    expect(body.error.message).toContain("enableDvr");
    expect(body.error.message).toContain("on air");
    // Refused before anything left the process — a locked field must not cost a write.
    expect(edited.updates).toHaveLength(0);
  });

  it("still takes a title on a broadcast that is on air — that is the 22:58 edit", async () => {
    const edited: Edited = { updates: [], binds: [], videoUpdates: [] };
    const yt = editableYt(edited, {
      id: "b1",
      snippet: { title: "wrong title", description: "the usual" },
      status: { privacyStatus: "public", lifeCycleStatus: "live" },
      contentDetails: { boundStreamId: "s1", enableAutoStart: true },
    });
    const m = await mount(ctxFor(yt));
    close = m.close;

    const res = await fetch(`${m.url}/b1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Harvest service" }),
    });

    expect(res.status).toBe(200);
    expect(edited.updates[0].snippet?.title).toBe("Harvest service");
  });

  it("sends a category change to videos.update, never into the broadcast body", async () => {
    const edited: Edited = { updates: [], binds: [], videoUpdates: [] };
    const yt = editableYt(edited, {
      id: "b1",
      snippet: { title: "Sunday service", description: "the usual" },
      status: { privacyStatus: "public", lifeCycleStatus: "ready" },
      contentDetails: { boundStreamId: "s1" },
    });
    const m = await mount(ctxFor(yt));
    close = m.close;

    const res = await fetch(`${m.url}/b1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: "29" }),
    });

    expect(res.status).toBe(200);
    expect(edited.videoUpdates[0].snippet?.categoryId).toBe("29");
    // Category is not a broadcast field, so a category-only edit spends no broadcast write.
    expect(edited.updates).toHaveLength(0);
    // Read, then the video read and write: 1 + 1 + 50.
    expect(((await res.json()) as { quotaUnits: number }).quotaUnits).toBe(52);
  });

  it("reports a rebind YouTube will not allow as a state refusal, not as a login problem", async () => {
    const edited: Edited = { updates: [], binds: [], videoUpdates: [] };
    const yt = editableYt(edited, {
      id: "b1",
      snippet: { title: "Sunday service" },
      status: { privacyStatus: "public", lifeCycleStatus: "ready" },
      contentDetails: { boundStreamId: "s1" },
    });
    // YouTube's own refusal shape: a 403 whose reason is about the broadcast's state, which
    // without issue 070's mapping read as an auth failure and raised a reconnect banner.
    (yt.liveBroadcasts as unknown as { bind: () => Promise<never> }).bind = async () => {
      throw {
        response: { status: 403, data: { error: { errors: [{ reason: "liveBroadcastBindingNotAllowed" }] } } },
      };
    };
    const m = await mount(ctxFor(yt));
    close = m.close;

    const res = await fetch(`${m.url}/b1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ streamId: "s2" }),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("BROADCAST_STATE_LOCKED");
  });

  /** A context whose store actually holds — and keeps — its ownership records. */
  function ctxWithStore(yt: youtube_v3.Youtube, prepared: unknown[]): Partial<AppContext> {
    const state = { service: { apiEnabled: true }, preparedBroadcasts: prepared };
    return {
      yt,
      store: {
        get: () => state,
        update: async (fn: (s: typeof state) => void) => {
          fn(state);
        },
      } as unknown as AppContext["store"],
      logger: { push: () => {} } as unknown as AppContext["logger"],
      cache: { refresh: async () => {} } as unknown as AppContext["cache"],
    };
  }

  it("moves the ownership record with the broadcast, so the next sweep does not delete what was just rescheduled", async () => {
    const edited: Edited = { updates: [], binds: [], videoUpdates: [] };
    const yt = editableYt(edited, {
      id: "b1",
      snippet: { title: "Sunday service", scheduledStartTime: "2020-01-01T18:00:00Z" },
      status: { privacyStatus: "public", lifeCycleStatus: "ready" },
      contentDetails: { boundStreamId: "s1" },
    });
    const prepared = [
      {
        id: "b1",
        title: "Sunday service",
        privacyStatus: "public",
        scheduledStartTime: "2020-01-01T18:00:00Z",
        streamId: "s1",
        watchUrl: "https://youtu.be/b1",
        createdAt: "2020-01-01T00:00:00Z",
        presetId: null,
        airedAt: null,
        retiredAt: null,
        retiredReason: null,
      },
    ];
    const ctx = ctxWithStore(yt, prepared);
    const m = await mount(ctx);
    close = m.close;

    const res = await fetch(`${m.url}/b1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Harvest service",
        scheduledStartTime: "2030-01-01T18:00:00Z",
        privacyStatus: "unlisted",
      }),
    });

    expect(res.status).toBe(200);
    // The record is what the sweep, the "Made here" list and the delete confirmation read.
    const record = (ctx.store as unknown as { get: () => { preparedBroadcasts: Array<Record<string, unknown>> } })
      .get()
      .preparedBroadcasts[0];
    expect(record.scheduledStartTime).toBe("2030-01-01T18:00:00Z");
    expect(record.title).toBe("Harvest service");
    expect(record.privacyStatus).toBe("unlisted");
    // Nothing else on the record was touched — it is not a cache of YouTube.
    expect(record.watchUrl).toBe("https://youtu.be/b1");
    expect(record.createdAt).toBe("2020-01-01T00:00:00Z");
  });

  it("refuses a start time that is not a date, rather than paying YouTube to say so", async () => {
    const edited: Edited = { updates: [], binds: [], videoUpdates: [] };
    const yt = editableYt(edited, {
      id: "b1",
      snippet: { title: "Sunday service" },
      status: { privacyStatus: "public", lifeCycleStatus: "ready" },
      contentDetails: { boundStreamId: "s1" },
    });
    const m = await mount(ctxFor(yt));
    close = m.close;

    const res = await fetch(`${m.url}/b1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduledStartTime: "next Sunday" }),
    });

    expect(res.status).toBe(400);
    // A 502 would file it with the outages nobody can act on; this one the operator can fix.
    expect(edited.updates).toHaveLength(0);
  });

  it("refuses a null category instead of answering 200 having written nothing", async () => {
    const edited: Edited = { updates: [], binds: [], videoUpdates: [] };
    const yt = editableYt(edited, {
      id: "b1",
      snippet: { title: "Sunday service" },
      status: { privacyStatus: "public", lifeCycleStatus: "ready" },
      contentDetails: { boundStreamId: "s1" },
    });
    const m = await mount(ctxFor(yt));
    close = m.close;

    const res = await fetch(`${m.url}/b1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: null }),
    });

    expect(res.status).toBe(400);
    expect(edited.videoUpdates).toHaveLength(0);
  });

  it("says what already landed when a later call fails, because nothing rolls the earlier ones back", async () => {
    const edited: Edited = { updates: [], binds: [], videoUpdates: [] };
    const yt = editableYt(edited, {
      id: "b1",
      snippet: { title: "Sunday service", scheduledStartTime: "2020-01-01T18:00:00Z" },
      status: { privacyStatus: "public", lifeCycleStatus: "ready" },
      contentDetails: { boundStreamId: "s1" },
    });
    (yt.liveBroadcasts as unknown as { bind: () => Promise<never> }).bind = async () => {
      throw { response: { status: 500 } };
    };
    const prepared = [
      {
        id: "b1",
        title: "Sunday service",
        privacyStatus: "public",
        scheduledStartTime: "2020-01-01T18:00:00Z",
        streamId: "s1",
        watchUrl: "https://youtu.be/b1",
        createdAt: "2020-01-01T00:00:00Z",
        presetId: null,
        airedAt: null,
        retiredAt: null,
        retiredReason: null,
      },
    ];
    const ctx = ctxWithStore(yt, prepared);
    const m = await mount(ctx);
    close = m.close;

    const res = await fetch(`${m.url}/b1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Harvest service", streamId: "s2" }),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { message: string } };
    // The title *was* written. A bare "could not save" is what gets an operator to press again.
    expect(body.error.message).toContain("Already saved: title");
    // And the record says so too, so the list is not showing a title YouTube no longer has.
    const record = (ctx.store as unknown as { get: () => { preparedBroadcasts: Array<Record<string, unknown>> } })
      .get()
      .preparedBroadcasts[0];
    expect(record.title).toBe("Harvest service");
    expect(record.streamId).toBe("s1");
  });

  it("hands the form every field it can edit, including the ones the list never carried", async () => {
    const edited: Edited = { updates: [], binds: [], videoUpdates: [] };
    const yt = editableYt(edited, {
      id: "b1",
      snippet: {
        title: "Sunday service",
        description: "the usual",
        scheduledStartTime: "2026-09-06T18:00:00Z",
        scheduledEndTime: "2026-09-06T19:30:00Z",
      },
      status: { privacyStatus: "unlisted", lifeCycleStatus: "ready" },
      contentDetails: {
        boundStreamId: "s1",
        enableAutoStart: true,
        enableAutoStop: false,
        enableDvr: true,
        enableEmbed: false,
        monitorStream: { enableMonitorStream: false },
      },
    });
    const m = await mount(ctxFor(yt));
    close = m.close;

    const res = await fetch(`${m.url}/b1/edit`);
    expect(res.status).toBe(200);
    const view = (await res.json()) as BroadcastEditView;

    // The list carries none of these — description, the end time, the flags, the category — and
    // a form that opened without them would silently offer to blank them.
    expect(view.description).toBe("the usual");
    expect(view.scheduledEndTime).toBe("2026-09-06T19:30:00Z");
    expect(view.privacyStatus).toBe("unlisted");
    expect(view.lifeCycleStatus).toBe("ready");
    expect(view.enableAutoStop).toBe(false);
    expect(view.enableDvr).toBe(true);
    expect(view.enableMonitorStream).toBe(false);
    expect(view.boundStreamId).toBe("s1");
    expect(view.category).toBe("22");
    // Two reads: the broadcast, and the video the category lives on.
    expect(view.quotaUnits).toBe(2);
  });
});
