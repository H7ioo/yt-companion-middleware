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
import type { PreparedBroadcast } from "../storage/schema.js";

/** The channel, and a record of everything the routes asked it to do. */
interface FakeState {
  /** What `liveBroadcasts.list` knows about, by id. */
  channel: youtube_v3.Schema$LiveBroadcast[];
  deleted: string[];
  inserts: any[];
  deleteError?: unknown;
  listError?: unknown;
  insertError?: unknown;
}

function fakeYt(state: FakeState): youtube_v3.Youtube {
  return {
    liveBroadcasts: {
      list: async (params: any) => {
        if (state.listError) throw state.listError;
        const ids: string[] = params.id ?? [];
        return { data: { items: state.channel.filter((b) => ids.includes(b.id ?? "")) } };
      },
      delete: async (params: any) => {
        if (state.deleteError) throw state.deleteError;
        state.deleted.push(params.id);
        return { data: {} };
      },
      insert: async (params: any) => {
        state.inserts.push(params);
        if (state.insertError) throw state.insertError;
        return { data: { id: "new-1", ...(params.requestBody ?? {}) } };
      },
      bind: async (params: any) => ({ data: { id: params.id } }),
    },
    liveStreams: {
      insert: async () => {
        throw new Error("liveStreams.insert must never be called");
      },
    },
    videos: {
      list: async () => ({ data: { items: [{ snippet: { title: "t" } }] } }),
      update: async () => ({ data: {} }),
    },
  } as unknown as youtube_v3.Youtube;
}

const record = (over: Partial<PreparedBroadcast> = {}): PreparedBroadcast => ({
  id: "ours-1",
  title: "Friday night",
  privacyStatus: "public",
  // Long past due by the time these tests run their clock forward.
  scheduledStartTime: "2020-01-01T18:00:00.000Z",
  streamId: "stream-9",
  watchUrl: "https://www.youtube.com/watch?v=ours-1",
  createdAt: "2020-01-01T10:00:00.000Z",
  presetId: null,
  airedAt: null,
  retiredAt: null,
  retiredReason: null,
  ...over,
});

let dir: string;
let store: JsonStore;
let close: (() => Promise<void>) | null = null;
let logger: { push: ReturnType<typeof vi.fn> };
let audit: { record: ReturnType<typeof vi.fn> };

async function mount(state: FakeState) {
  logger = { push: vi.fn() };
  audit = { record: vi.fn(async () => {}) };
  const ctx = {
    yt: fakeYt(state),
    store,
    logger,
    audit,
    cache: { refresh: vi.fn(async () => {}) },
    quota: { snapshot: () => ({ used: 0 }) },
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

const del = (url: string, id: string, body?: unknown) =>
  fetch(`${url}/prepared/${id}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "retire-"));
  store = new JsonStore(path.join(dir, "store.json"));
  await store.init();
  await store.update((s) => {
    s.defaults = { defaultCategory: null, defaultStreamBoundId: "stream-default" };
  });
});

afterEach(async () => {
  await close?.();
  close = null;
  await fs.rm(dir, { recursive: true, force: true });
});

const idle = (id: string): youtube_v3.Schema$LiveBroadcast => ({
  id,
  snippet: { scheduledStartTime: "2020-01-01T18:00:00.000Z" },
  status: { lifeCycleStatus: "created" },
});

describe("POST /api/dashboard/broadcasts/retire", () => {
  it("retires an app-created, unused, past-due broadcast", async () => {
    await store.update((s) => {
      s.preparedBroadcasts = [record()];
    });
    const state: FakeState = { channel: [idle("ours-1")], deleted: [], inserts: [] };
    const url = await mount(state);

    const res = await fetch(`${url}/retire`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { retired: PreparedBroadcast[]; quotaUnits: number };
    expect(state.deleted).toEqual(["ours-1"]);
    expect(body.retired).toHaveLength(1);
    expect(body.quotaUnits).toBe(51);
  });

  it("never retires a broadcast the app did not create, whatever the channel holds", async () => {
    // Two past-due strays on the channel and no ownership record for either.
    const state: FakeState = {
      channel: [idle("studio-1"), idle("studio-2")],
      deleted: [],
      inserts: [],
    };
    const url = await mount(state);

    const res = await fetch(`${url}/retire`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(state.deleted).toEqual([]);
  });

  it("never retires one that aired", async () => {
    await store.update((s) => {
      s.preparedBroadcasts = [record()];
    });
    const state: FakeState = {
      channel: [
        {
          id: "ours-1",
          snippet: { actualStartTime: "2020-01-01T18:00:30.000Z" },
          status: { lifeCycleStatus: "complete" },
        },
      ],
      deleted: [],
      inserts: [],
    };
    const url = await mount(state);

    await fetch(`${url}/retire`, { method: "POST" });
    expect(state.deleted).toEqual([]);
    expect(store.get().preparedBroadcasts[0].airedAt).toBe("2020-01-01T18:00:30.000Z");
    expect(store.get().preparedBroadcasts[0].retiredAt).toBeNull();
  });

  it("records what was removed and why, where the operator can see it", async () => {
    await store.update((s) => {
      s.preparedBroadcasts = [record()];
    });
    const state: FakeState = { channel: [idle("ours-1")], deleted: [], inserts: [] };
    const url = await mount(state);

    await fetch(`${url}/retire`, { method: "POST" });

    const kept = store.get().preparedBroadcasts[0];
    expect(kept.retiredAt).not.toBeNull();
    expect(kept.retiredReason).toMatch(/never went to air/i);
    const logged = logger.push.mock.calls.map((c) => String(c[0].message)).join("\n");
    expect(logged).toContain("Friday night");
    expect(logged).toMatch(/never went to air/i);
  });
});

describe("DELETE /api/dashboard/broadcasts/prepared/:id", () => {
  beforeEach(async () => {
    await store.update((s) => {
      s.preparedBroadcasts = [record()];
    });
  });

  it("refuses without a confirmation, and says what the confirmation is for", async () => {
    const state: FakeState = { channel: [idle("ours-1")], deleted: [], inserts: [] };
    const url = await mount(state);

    const res = await del(url, "ours-1");
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string }; confirmation: any };
    expect(state.deleted).toEqual([]);
    // Names the broadcast, and warns that the shared link breaks — the harm that does not undo.
    expect(body.confirmation.question).toContain("Friday night");
    expect(body.confirmation.warning).toContain("https://www.youtube.com/watch?v=ours-1");
  });

  it("deletes on a confirmed press and records it", async () => {
    const state: FakeState = { channel: [idle("ours-1")], deleted: [], inserts: [] };
    const url = await mount(state);

    const res = await del(url, "ours-1", { confirm: true });
    expect(res.status).toBe(200);
    expect(state.deleted).toEqual(["ours-1"]);
    const kept = store.get().preparedBroadcasts[0];
    expect(kept.retiredAt).not.toBeNull();
    expect(kept.retiredReason).toMatch(/by hand|deleted/i);
    expect(logger.push).toHaveBeenCalled();
  });

  it("refuses an id this app has no ownership record for, confirmed or not", async () => {
    const state: FakeState = { channel: [idle("studio-1")], deleted: [], inserts: [] };
    const url = await mount(state);

    const res = await del(url, "studio-1", { confirm: true });
    expect(res.status).toBe(404);
    expect(state.deleted).toEqual([]);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/did not create|not one this app/i);
  });

  it("refuses one it already retired rather than spending a write on nothing", async () => {
    await store.update((s) => {
      s.preparedBroadcasts = [record({ retiredAt: "2026-01-01T00:00:00.000Z" })];
    });
    const state: FakeState = { channel: [], deleted: [], inserts: [] };
    const url = await mount(state);

    const res = await del(url, "ours-1", { confirm: true });
    expect(res.status).toBe(409);
    expect(state.deleted).toEqual([]);
  });
});

describe("POST /api/dashboard/broadcasts/prepare, with cleanup", () => {
  const prepare = (url: string) =>
    fetch(`${url}/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Tonight", scheduledStartTime: "2026-09-04T18:00:00.000Z" }),
    });

  it("clears the ghosts before creating, so the insert is not the thing that finds the limit", async () => {
    await store.update((s) => {
      s.preparedBroadcasts = [record()];
    });
    const state: FakeState = { channel: [idle("ours-1")], deleted: [], inserts: [] };
    const url = await mount(state);

    const res = await prepare(url);
    expect(res.status).toBe(200);
    expect(state.deleted).toEqual(["ours-1"]);
    expect(state.inserts).toHaveLength(1);
  });

  it("still creates the broadcast when the sweep itself fails", async () => {
    await store.update((s) => {
      s.preparedBroadcasts = [record()];
    });
    const state: FakeState = {
      channel: [idle("ours-1")],
      deleted: [],
      inserts: [],
      listError: new Error("list is down"),
    };
    const url = await mount(state);

    const res = await prepare(url);
    expect(res.status).toBe(200);
    expect(state.inserts).toHaveLength(1);
  });

  it("names a full channel as a full channel, with the cleanup to do about it", async () => {
    const full: any = new Error("too many broadcasts");
    full.response = { status: 403, data: { error: { errors: [{ reason: "limitExceeded" }] } } };
    const state: FakeState = { channel: [], deleted: [], inserts: [], insertError: full };
    const url = await mount(state);

    const res = await prepare(url);
    // 409, not 502: the channel is in a state the operator can act on, not a server fault.
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BROADCAST_LIMIT_REACHED");
    expect(body.error.message).toMatch(/delete/i);
  });
});
