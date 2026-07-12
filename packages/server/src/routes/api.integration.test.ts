import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import type { youtube_v3 } from "googleapis";
import { JsonStore } from "../storage/jsonStore.js";
import { StateCache } from "../core/stateCache.js";
import { ActionRunner } from "../core/actionRunner.js";
import { QuotaTracker } from "../core/quota.js";
import { StateEvents } from "../core/events.js";
import { Logger } from "../core/logger.js";
import { mountApiRoutes } from "../app.js";
import { setupRouter } from "./setup.js";
import type { AppContext } from "./context.js";

/**
 * Route integration tests (PRD-05 §2.1): the real route table from app.ts, over real HTTP, with a
 * fake YouTube client. Unit tests already cover the core in isolation; what only shows up here is
 * the wiring — that a runner error reaches the client as a 200 + body-encoded code (PRD-01 §7),
 * that the error map survives the round trip, and that both action bases hit the same handler.
 */

/** Whatever the fake YouTube API should do on the next call. Mutated per-test. */
interface FakeState {
  /** The one broadcast the channel has, or null for an idle channel (→ NO_TARGET_FOUND). */
  broadcast: youtube_v3.Schema$LiveBroadcast | null;
  /** Thrown by every call when set — used to drive the mapYouTubeError paths. */
  error?: unknown;
  /** Awaited inside liveBroadcasts.list, so a test can hold an action in flight (busy/queue). */
  gate?: Promise<void>;
  streams?: youtube_v3.Schema$LiveStream[];
}

/** The slice of the YouTube API this app actually calls. Everything else is left undefined. */
function fakeYouTube(state: FakeState): youtube_v3.Youtube {
  const guard = async () => {
    if (state.gate) await state.gate;
    if (state.error) throw state.error;
  };
  const items = () => (state.broadcast ? [state.broadcast] : []);
  return {
    liveBroadcasts: {
      list: async (params: youtube_v3.Params$Resource$Livebroadcasts$List) => {
        await guard();
        // Only `active` and an id-lookup resolve; `upcoming`/`persistent` come back empty, so an
        // absent broadcast walks the full resolveTarget fallback chain and ends in NO_TARGET_FOUND.
        const matches = params.id != null || params.broadcastStatus === "active";
        return { data: { items: matches ? items() : [] } };
      },
      update: async (params: youtube_v3.Params$Resource$Livebroadcasts$Update) => {
        await guard();
        state.broadcast = params.requestBody as youtube_v3.Schema$LiveBroadcast;
        return { data: state.broadcast };
      },
      bind: async () => ({ data: {} }),
    },
    videos: {
      list: async () => ({ data: { items: [{ snippet: { title: "t" } }] } }),
      update: async () => ({ data: {} }),
    },
    liveStreams: {
      list: async () => {
        await guard();
        return { data: { items: state.streams ?? [] } };
      },
    },
  } as unknown as youtube_v3.Youtube;
}

const liveBroadcast = (): youtube_v3.Schema$LiveBroadcast => ({
  id: "bc1",
  snippet: { title: "Original title", description: "desc" },
  status: { privacyStatus: "private", lifeCycleStatus: "live" },
  contentDetails: { boundStreamId: "s1" },
});

/** A 401/403 as googleapis reports it — the shape mapYouTubeError reads. */
const httpError = (status: number, reason?: string) => ({
  response: {
    status,
    data: reason ? { error: { errors: [{ reason }] } } : undefined,
  },
  message: `HTTP ${status}`,
});

interface Harness {
  url: string;
  store: JsonStore;
  state: FakeState;
  close: () => Promise<void>;
}

/** Boots the credentialed route table on an ephemeral port, exactly as server.ts wires it. */
async function boot(): Promise<Harness> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "api-integration-"));
  const store = new JsonStore(path.join(dir, "store.json"));
  await store.init();

  const state: FakeState = { broadcast: liveBroadcast() };
  const yt = fakeYouTube(state);
  const events = new StateEvents();
  const logger = new Logger();
  const quota = new QuotaTracker(store, 10000, events, logger);
  quota.init();
  // Never started: the poll loop would race the assertions. Tests drive refresh explicitly.
  const cache = new StateCache(
    yt,
    store,
    { refreshIntervalMs: 60_000, healthFailureThreshold: 3 },
    events,
    logger,
  );
  const runner = new ActionRunner(yt, store, cache, events, logger);
  const ctx: AppContext = { store, runner, cache, yt, quota, events, logger, regionCode: "US" };

  const app = express();
  app.use(express.json());
  app.use("/api/setup", setupRouter({ store, configured: true, requestRestart: () => {} }));
  mountApiRoutes(app, ctx);

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    store,
    state,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

let h: Harness;

beforeEach(async () => {
  h = await boot();
});
afterEach(async () => {
  await h.close();
});

/** GET/POST helper returning status + parsed body together — every assertion needs both. */
async function call(
  method: "GET" | "POST" | "PUT" | "DELETE",
  route: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${h.url}${route}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Creates a preset through the API, so the tests exercise the same validation the UI does. */
async function createPreset(fields: Record<string, unknown> = {}): Promise<string> {
  const res = await call("POST", "/api/dashboard/presets", {
    title: "Friday Khutbah",
    privacyStatus: "public",
    ...fields,
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("action routes: always 200, success/error in the body (PRD-01 §7)", () => {
  it("applies a preset and reports the new status", async () => {
    const id = await createPreset({ title: "Jumu'ah", privacyStatus: "public" });
    const res = await call("POST", "/api/action/preset", { presetId: id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      status: { title: "Jumu'ah", privacyStatus: "public" },
      target: { id: "bc1", isLive: true },
    });
    expect(h.state.broadcast?.snippet?.title).toBe("Jumu'ah");
  });

  it("updates ad-hoc metadata", async () => {
    const res = await call("POST", "/api/action/update", { title: "Ad hoc" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status.title).toBe("Ad hoc");
  });

  it("toggles privacy without touching the title", async () => {
    const res = await call("POST", "/api/action/privacy", {});
    expect(res.status).toBe(200);
    expect(res.body.status).toMatchObject({ title: "Original title", privacyStatus: "public" });
  });

  it("undoes the previous change", async () => {
    await call("POST", "/api/action/update", { title: "Mistake" });
    const res = await call("POST", "/api/action/undo");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: { title: "Original title" } });
  });

  it("refreshes the cache from YouTube", async () => {
    const res = await call("POST", "/api/action/refresh");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, health: "ok" });
    expect(res.body.status.title).toBe("Original title");
  });

  it("refresh returns the full dashboard state — quota/undo/apiEnabled, not a partial cache (PRD-10 §1)", async () => {
    // Make an undoable change so an undo snapshot exists to surface across the refresh.
    await call("POST", "/api/action/update", { title: "Changed" });

    const refresh = await call("POST", "/api/action/refresh");
    expect(refresh.status).toBe(200);
    expect(refresh.body.success).toBe(true);

    // The refresh payload carries the same authoritative fields the /state route serves — a raw
    // cache snapshot has none of these, and the client would blank them until the next push.
    const state = await call("GET", "/api/dashboard/state");
    expect(refresh.body.quota).toEqual(state.body.quota);
    expect(refresh.body.quota).toMatchObject({ limit: 10000 });
    expect(refresh.body.apiEnabled).toBe(state.body.apiEnabled);
    expect(refresh.body).toHaveProperty("busy", false);
    // Fully-assembled state fields the raw snapshot never carried are present too.
    expect(typeof refresh.body.displayLabel).toBe("string");
    // Undo stayed available across the refresh (the operator can still revert immediately).
    expect(refresh.body.undo).not.toBeNull();
    expect(refresh.body.undo).toEqual(state.body.undo);
  });

  it("returns 200 + NO_UNDO_AVAILABLE when nothing has changed yet", async () => {
    const res = await call("POST", "/api/action/undo");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: { code: "NO_UNDO_AVAILABLE", message: expect.any(String) },
    });
  });

  it("returns 200 + INVALID_PRESET for an unknown preset id", async () => {
    const res = await call("POST", "/api/action/preset", { presetId: "nope" });
    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe("INVALID_PRESET");
  });

  it("returns 200 + MISSING_TEMPLATE_VARS when a template var has no value and no fallback", async () => {
    const id = await createPreset({ title: "Khutbah — {speaker}" });
    const res = await call("POST", "/api/action/preset", { presetId: id });
    expect(res.status).toBe(200);
    expect(res.body.error).toMatchObject({ code: "MISSING_TEMPLATE_VARS" });
    expect(res.body.error.message).toContain("speaker");
  });

  it("returns 200 + INVALID_REQUEST for a malformed body", async () => {
    const res = await call("POST", "/api/action/update", { title: "" });
    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 200 + NO_TARGET_FOUND on an idle channel", async () => {
    h.state.broadcast = null;
    const res = await call("POST", "/api/action/update", { title: "x" });
    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe("NO_TARGET_FOUND");
  });

  it("returns 200 + SERVICE_DISABLED when the API master switch is off", async () => {
    const off = await call("PUT", "/api/dashboard/service", { apiEnabled: false });
    expect(off.body).toEqual({ apiEnabled: false });
    const res = await call("POST", "/api/action/update", { title: "x" });
    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe("SERVICE_DISABLED");
    // And no YouTube call was made — the switch is checked before the client is touched.
    expect(h.state.broadcast?.snippet?.title).toBe("Original title");
  });
});

describe("action routes: YouTube error mapping survives the round trip", () => {
  it("maps a 401 to YOUTUBE_AUTH_ERROR", async () => {
    h.state.error = httpError(401);
    const res = await call("POST", "/api/action/update", { title: "x" });
    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe("YOUTUBE_AUTH_ERROR");
  });

  it("maps a 403 quotaExceeded to YOUTUBE_QUOTA_EXCEEDED", async () => {
    h.state.error = httpError(403, "quotaExceeded");
    const res = await call("POST", "/api/action/update", { title: "x" });
    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe("YOUTUBE_QUOTA_EXCEEDED");
  });

  it("maps a transport failure to NETWORK_ERROR, not an auth problem (PRD-06 §0)", async () => {
    h.state.error = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const res = await call("POST", "/api/action/update", { title: "x" });
    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe("NETWORK_ERROR");
  });

  it("returns 200 + BUSY_TRY_AGAIN once one action runs and one is queued (PRD §5.5)", async () => {
    let open!: () => void;
    h.state.gate = new Promise<void>((r) => {
      open = r;
    });
    const first = call("POST", "/api/action/update", { title: "a" });
    const second = call("POST", "/api/action/update", { title: "b" });
    // Let both requests reach the runner and take the in-flight + queued slots.
    await new Promise((r) => setTimeout(r, 50));
    const third = await call("POST", "/api/action/update", { title: "c" });
    expect(third.status).toBe(200);
    expect(third.body.error.code).toBe("BUSY_TRY_AGAIN");
    open();
    await Promise.all([first, second]);
  });
});

describe("dual-alias guarantee: /api/action/* and /api/dashboard/action/* are the same handler", () => {
  it("serves every action verb identically under both bases", async () => {
    const id = await createPreset({ title: "Aliased", privacyStatus: "unlisted" });
    for (const base of ["/api/action", "/api/dashboard/action"]) {
      const res = await call("POST", `${base}/preset`, { presetId: id });
      expect(res.status, base).toBe(200);
      expect(res.body.success, base).toBe(true);
      expect(res.body.status.title, base).toBe("Aliased");
    }
    // Errors travel the same path too, not just the happy one.
    for (const base of ["/api/action", "/api/dashboard/action"]) {
      const res = await call("POST", `${base}/preset`, { presetId: "nope" });
      expect(res.status, base).toBe(200);
      expect(res.body.error.code, base).toBe("INVALID_PRESET");
    }
  });

  it("exposes update, privacy, undo and refresh under the dashboard base as well", async () => {
    for (const route of ["/update", "/privacy", "/undo", "/refresh"]) {
      const body = route === "/update" ? { title: "x" } : {};
      const res = await call("POST", `/api/dashboard/action${route}`, body);
      // Reachable and contract-abiding — never a 404 from a missing alias.
      expect(res.status, route).toBe(200);
      expect(res.body.success, route).toBe(true);
    }
  });
});

describe("feedback routes (cache-served, zero quota)", () => {
  it("serves the health probe with the quota budget", async () => {
    const res = await call("GET", "/api/feedback/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      authenticated: true,
      apiEnabled: true,
      quotaLimit: 10000,
    });
  });

  it("reports auth_error + authenticated:false after YouTube rejects the token", async () => {
    h.state.error = httpError(401);
    // The threshold is 3 — escalate past it so health lands on auth_error rather than degraded.
    for (let i = 0; i < 3; i++) await call("POST", "/api/action/refresh");
    const res = await call("GET", "/api/feedback/health");
    expect(res.body).toMatchObject({ status: "auth_error", authenticated: false });
  });

  it("serves the active-preset superset after a preset is applied", async () => {
    const id = await createPreset({ title: "Fajr", slug: "FAJR", privacyStatus: "public" });
    await call("POST", "/api/action/preset", { presetId: id });
    const res = await call("GET", "/api/feedback/active-preset");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      activePresetId: id,
      title: "Fajr",
      displayLabel: "FAJR",
      isLive: true,
      busy: false,
      health: "ok",
    });
    expect(res.body.activePreset.id).toBe(id);
    expect(typeof res.body.slugPng).toBe("string");
  });

  it("serves status and busy", async () => {
    const status = await call("GET", "/api/feedback/status");
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ title: null, privacyStatus: null, isLive: false });
    const busy = await call("GET", "/api/feedback/busy");
    expect(busy.body).toEqual({ busy: false });
  });

  it("renders slug.png, and 404s title.png when there is no live title to draw", async () => {
    const png = await fetch(`${h.url}/api/feedback/slug.png`);
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");
    const title = await call("GET", "/api/feedback/title.png");
    expect(title.status).toBe(404);
  });
});

describe("dashboard routes", () => {
  it("serves the state rail from the cache", async () => {
    await call("POST", "/api/action/refresh");
    const res = await call("GET", "/api/dashboard/state");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      health: "ok",
      busy: false,
      apiEnabled: true,
      status: { title: "Original title", isLive: true },
    });
    expect(res.body.quota).toMatchObject({ limit: 10000 });
  });

  it("round-trips preset CRUD, and 404s an unknown id", async () => {
    const id = await createPreset({ title: "One" });
    const list = await call("GET", "/api/dashboard/presets");
    expect(list.body).toHaveLength(1);

    const updated = await call("PUT", `/api/dashboard/presets/${id}`, {
      title: "Two",
      privacyStatus: "private",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe("Two");

    const missing = await call("PUT", "/api/dashboard/presets/ghost", {
      title: "Two",
      privacyStatus: "private",
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("INVALID_PRESET");

    const bad = await call("POST", "/api/dashboard/presets", { privacyStatus: "public" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_REQUEST");

    expect((await call("DELETE", `/api/dashboard/presets/${id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/dashboard/presets/${id}`)).status).toBe(404);
  });

  it("exports and re-imports presets", async () => {
    await createPreset({ title: "Backed up" });
    const exported = await call("GET", "/api/dashboard/presets/export");
    expect(exported.body).toMatchObject({ version: 2 });

    const imported = await call("POST", "/api/dashboard/presets/import", {
      presets: exported.body.presets,
      mode: "replace",
    });
    expect(imported.status).toBe(200);
    expect(imported.body.count).toBe(1);
    expect(imported.body.presets[0].title).toBe("Backed up");
  });

  it("round-trips settings and rejects a malformed body", async () => {
    const put = await call("PUT", "/api/dashboard/settings", {
      defaultCategory: "22",
      defaultStreamBoundId: null,
    });
    expect(put.status).toBe(200);
    expect((await call("GET", "/api/dashboard/settings")).body.defaultCategory).toBe("22");

    const bad = await call("PUT", "/api/dashboard/settings", { defaultCategory: "" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_REQUEST");
  });

  it("lists the channel's streams, and 502s a YouTube failure", async () => {
    // Error first: a failed list is never cached, so the success below still hits YouTube. The
    // reverse order would be served from the router's 30s cache and prove nothing.
    h.state.error = httpError(401);
    const failed = await call("GET", "/api/dashboard/streams");
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe("YOUTUBE_AUTH_ERROR");

    h.state.error = undefined;
    h.state.streams = [
      { id: "s1", snippet: { title: "Main" }, cdn: { ingestionInfo: { streamName: "key-1" } } },
    ];
    const ok = await call("GET", "/api/dashboard/streams");
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual([{ id: "s1", title: "Main", streamName: "key-1" }]);
  });

  it("records actions on the activity feed", async () => {
    await call("POST", "/api/action/update", { title: "Logged" });
    const res = await call("GET", "/api/dashboard/logs");
    expect(res.status).toBe(200);
    const entries = Array.isArray(res.body) ? res.body : res.body.entries;
    expect(entries.some((e: { message: string }) => e.message.includes("Logged"))).toBe(true);
  });
});

describe("setup route under a configured boot", () => {
  it("reports configured without ever echoing a secret", async () => {
    await h.store.update((s) => {
      s.credentials = { clientId: "id", clientSecret: "sec", refreshToken: "1//tok" };
    });
    const res = await call("GET", "/api/setup/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      hasClientId: true,
      hasRefreshToken: true,
      // No browser to open in a headless boot, so the in-app OAuth flow is unavailable.
      canConnect: false,
    });
    expect(JSON.stringify(res.body)).not.toContain("1//tok");
  });
});
