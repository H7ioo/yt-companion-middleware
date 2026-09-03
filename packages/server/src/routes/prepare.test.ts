import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import type { youtube_v3 } from "googleapis";
import { broadcastsRouter } from "./broadcasts.js";
import type { AppContext } from "./context.js";
import { JsonStore } from "../storage/jsonStore.js";
import type { Preset } from "../storage/schema.js";

/** What the fake channel should do on the next insert. */
interface FakeState {
  insertError?: unknown;
  inserts: any[];
  binds: any[];
  categoryUpdates: any[];
}

function fakeYt(state: FakeState): youtube_v3.Youtube {
  return {
    liveBroadcasts: {
      insert: async (params: any) => {
        state.inserts.push(params);
        if (state.insertError) throw state.insertError;
        return { data: { id: "new-1", ...(params.requestBody ?? {}) } };
      },
      bind: async (params: any) => {
        state.binds.push(params);
        return { data: { id: params.id } };
      },
    },
    liveStreams: {
      insert: async () => {
        throw new Error("liveStreams.insert must never be called");
      },
    },
    videos: {
      list: async () => ({ data: { items: [{ snippet: { title: "t" } }] } }),
      update: async (params: any) => {
        state.categoryUpdates.push(params);
        return { data: {} };
      },
    },
  } as unknown as youtube_v3.Youtube;
}

const preset = (over: Partial<Preset> = {}): Preset => ({
  id: "friday",
  title: "Friday night",
  slug: "FRI",
  description: "Doors at 7",
  privacyStatus: "unlisted",
  category: null,
  streamBoundId: "stream-9",
  titleFallback: null,
  descriptionFallback: null,
  ...over,
});

let dir: string;
let store: JsonStore;
let close: (() => Promise<void>) | null = null;

async function mount(state: FakeState, over: Partial<AppContext> = {}) {
  const ctx = {
    yt: fakeYt(state),
    store,
    logger: { push: vi.fn() },
    cache: { refresh: vi.fn(async () => {}) },
    audit: { record: vi.fn(async () => {}) },
    quota: { snapshot: () => ({ used: 0 }) },
    ...over,
  } as unknown as AppContext;
  const app = express();
  app.use(express.json());
  app.use("/api/dashboard/broadcasts", broadcastsRouter(ctx));
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  close = () => new Promise<void>((r) => server.close(() => r()));
  return `http://127.0.0.1:${port}/api/dashboard/broadcasts`;
}

const post = (url: string, body: unknown) =>
  fetch(`${url}/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "prepare-"));
  store = new JsonStore(path.join(dir, "store.json"));
  await store.init();
  await store.update((s) => {
    s.presets = [preset()];
    s.defaults = { defaultCategory: null, defaultStreamBoundId: "stream-default" };
  });
});

afterEach(async () => {
  await close?.();
  close = null;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("POST /api/dashboard/broadcasts/prepare", () => {
  it("creates the broadcast from a preset and hands back a copyable link", async () => {
    const state: FakeState = { inserts: [], binds: [], categoryUpdates: [] };
    const url = await mount(state);

    const res = await post(url, {
      presetId: "friday",
      scheduledStartTime: "2026-09-04T18:00:00.000Z",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { prepared: any; quotaUnits: number };

    // The metadata is in the creating request, so the title is right on the first frame.
    const snippet = state.inserts[0].requestBody.snippet;
    expect(snippet.title).toBe("Friday night");
    expect(snippet.description).toBe("Doors at 7");
    expect(snippet.scheduledStartTime).toBe("2026-09-04T18:00:00.000Z");
    expect(state.inserts[0].requestBody.status.privacyStatus).toBe("unlisted");
    expect(state.inserts[0].requestBody.contentDetails).toMatchObject({
      enableAutoStart: true,
      enableAutoStop: true,
    });

    expect(body.prepared.watchUrl).toBe("https://www.youtube.com/watch?v=new-1");
    expect(body.quotaUnits).toBe(100);
    // The preset's own key, not the app default: the preset is the more specific answer.
    expect(state.binds[0]).toMatchObject({ id: "new-1", streamId: "stream-9" });
  });

  it("records our ownership of it — the only safe basis for ever deleting one", async () => {
    const state: FakeState = { inserts: [], binds: [], categoryUpdates: [] };
    const url = await mount(state);
    await post(url, { presetId: "friday", scheduledStartTime: "2026-09-04T18:00:00.000Z" });

    const owned = store.get().preparedBroadcasts;
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({
      id: "new-1",
      title: "Friday night",
      streamId: "stream-9",
      presetId: "friday",
      watchUrl: "https://www.youtube.com/watch?v=new-1",
    });
  });

  it("takes the app default key when the preset names none", async () => {
    await store.update((s) => {
      s.presets = [preset({ streamBoundId: null })];
    });
    const state: FakeState = { inserts: [], binds: [], categoryUpdates: [] };
    const url = await mount(state);
    await post(url, { presetId: "friday", scheduledStartTime: "2026-09-04T18:00:00.000Z" });
    expect(state.binds[0].streamId).toBe("stream-default");
  });

  it("refuses when no existing key can be resolved, rather than creating one", async () => {
    await store.update((s) => {
      s.presets = [preset({ streamBoundId: null })];
      s.defaults = { defaultCategory: null, defaultStreamBoundId: null };
    });
    const state: FakeState = { inserts: [], binds: [], categoryUpdates: [] };
    const url = await mount(state);

    const res = await post(url, { presetId: "friday", scheduledStartTime: "2026-09-04T18:00:00.000Z" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("INVALID_REQUEST");
    // Refused before anything was created — a broadcast nobody can feed is worse than none.
    expect(state.inserts).toHaveLength(0);
  });

  it("accepts an ad-hoc payload with no preset behind it", async () => {
    const state: FakeState = { inserts: [], binds: [], categoryUpdates: [] };
    const url = await mount(state);
    const res = await post(url, {
      title: "One-off",
      description: "",
      privacyStatus: "public",
      category: "24",
      streamId: "stream-x",
      scheduledStartTime: "2026-09-04T18:00:00.000Z",
    });
    expect(res.status).toBe(200);
    expect(state.inserts[0].requestBody.snippet.title).toBe("One-off");
    expect(state.binds[0].streamId).toBe("stream-x");
    expect(state.categoryUpdates[0].requestBody.snippet.categoryId).toBe("24");
    expect(store.get().preparedBroadcasts[0].presetId).toBeNull();
  });

  it("resolves the preset's template variables before the insert, never after", async () => {
    await store.update((s) => {
      s.presets = [preset({ title: "Service — {date}" })];
    });
    const state: FakeState = { inserts: [], binds: [], categoryUpdates: [] };
    const url = await mount(state);
    const res = await post(url, {
      presetId: "friday",
      scheduledStartTime: "2026-09-04T18:00:00.000Z",
      vars: { date: "4 Sept" },
    });
    expect(res.status).toBe(200);
    expect(state.inserts[0].requestBody.snippet.title).toBe("Service — 4 Sept");
  });

  it("refuses before any YouTube call when a template variable has no value", async () => {
    await store.update((s) => {
      s.presets = [preset({ title: "Service — {date}" })];
    });
    const state: FakeState = { inserts: [], binds: [], categoryUpdates: [] };
    const url = await mount(state);
    const res = await post(url, {
      presetId: "friday",
      scheduledStartTime: "2026-09-04T18:00:00.000Z",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("MISSING_TEMPLATE_VARS");
    expect(state.inserts).toHaveLength(0);
  });

  it("spends nothing while the YouTube API is paused", async () => {
    await store.update((s) => {
      s.service = { apiEnabled: false };
    });
    const state: FakeState = { inserts: [], binds: [], categoryUpdates: [] };
    const url = await mount(state);
    const res = await post(url, { presetId: "friday", scheduledStartTime: "2026-09-04T18:00:00.000Z" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe("SERVICE_DISABLED");
    expect(state.inserts).toHaveLength(0);
  });

  it("records the channel as driving once an insert has actually succeeded", async () => {
    const state: FakeState = { inserts: [], binds: [], categoryUpdates: [] };
    const url = await mount(state);
    await post(url, { presetId: "friday", scheduledStartTime: "2026-09-04T18:00:00.000Z" });
    expect(store.get().liveEligibility.mode).toBe("driving");
  });

  it("surfaces a refused insert as riding mode, and records it", async () => {
    const state: FakeState = {
      inserts: [],
      binds: [],
      categoryUpdates: [],
      insertError: Object.assign(new Error("The user is not enabled for live streaming."), {
        response: {
          status: 403,
          data: { error: { errors: [{ reason: "liveStreamingNotEnabled" }] } },
        },
      }),
    };
    const url = await mount(state);
    const res = await post(url, { presetId: "friday", scheduledStartTime: "2026-09-04T18:00:00.000Z" });

    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe("LIVE_NOT_ELIGIBLE");
    const eligibility = store.get().liveEligibility;
    expect(eligibility.mode).toBe("riding");
    expect(eligibility.reason).toBe("liveStreamingNotEnabled");
    expect(store.get().preparedBroadcasts).toHaveLength(0);
  });

  it("rejects a scheduled start that is not a timestamp", async () => {
    const state: FakeState = { inserts: [], binds: [], categoryUpdates: [] };
    const url = await mount(state);
    const res = await post(url, { presetId: "friday", scheduledStartTime: "tonight" });
    expect(res.status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });
});

describe("GET /api/dashboard/broadcasts/prepared", () => {
  it("lists what this app created, newest first, without spending a unit", async () => {
    const state: FakeState = { inserts: [], binds: [], categoryUpdates: [] };
    const url = await mount(state);
    await store.update((s) => {
      s.preparedBroadcasts = [
        {
          id: "old",
          title: "Last week",
          privacyStatus: "unlisted",
          scheduledStartTime: "2026-08-28T18:00:00.000Z",
          streamId: "stream-9",
          watchUrl: "https://www.youtube.com/watch?v=old",
          createdAt: "2026-08-27T10:00:00.000Z",
          presetId: null,
        },
        {
          id: "new",
          title: "Tonight",
          privacyStatus: "unlisted",
          scheduledStartTime: "2026-09-04T18:00:00.000Z",
          streamId: "stream-9",
          watchUrl: "https://www.youtube.com/watch?v=new",
          createdAt: "2026-09-03T10:00:00.000Z",
          presetId: null,
        },
      ];
    });

    const res = await fetch(`${url}/prepared`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any[]).map((p) => p.id)).toEqual(["new", "old"]);
    expect(state.inserts).toHaveLength(0);
  });
});
