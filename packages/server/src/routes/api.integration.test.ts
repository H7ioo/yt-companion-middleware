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
import { FillRequests } from "../core/fillRequests.js";
import { mountApiRoutes, mountAuditTrail, mountBootRoutes } from "../app.js";
import { AuditLog } from "../audit/log.js";
import { attachStateSocket } from "./socket.js";
import WebSocket from "ws";
import type { AppContext } from "./context.js";
import { Auth, SESSION_COOKIE } from "../auth/actor.js";

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
  /** Broadcasts the channel has scheduled but not started — the pool the pin picks from. */
  upcoming?: youtube_v3.Schema$LiveBroadcast[];
  categories?: youtube_v3.Schema$VideoCategory[];
  /** Every regionCode videoCategories.list was called with — the cache tests read this. */
  categoryRegions: string[];
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
        if (params.broadcastStatus === "upcoming")
          return { data: { items: state.upcoming ?? [] } };
        if (params.id != null) {
          const byId = [...items(), ...(state.upcoming ?? [])].filter(
            (b) => b.id === params.id![0],
          );
          return { data: { items: byId } };
        }
        // `active` resolves; `persistent` comes back empty, so an absent broadcast walks the full
        // resolveTarget fallback chain and ends in NO_TARGET_FOUND.
        const matches = params.broadcastStatus === "active";
        return { data: { items: matches ? items() : [] } };
      },
      update: async (
        params: youtube_v3.Params$Resource$Livebroadcasts$Update,
      ) => {
        await guard();
        const body = params.requestBody as youtube_v3.Schema$LiveBroadcast;
        // Write back to whichever broadcast the request names, not unconditionally to the active
        // one: with several upcoming events on the channel, "which one did the write land on" is
        // the entire question these tests exist to answer.
        const index = (state.upcoming ?? []).findIndex((b) => b.id === body.id);
        if (index >= 0) state.upcoming![index] = body;
        else state.broadcast = body;
        return { data: body };
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
    videoCategories: {
      list: async (params: youtube_v3.Params$Resource$Videocategories$List) => {
        // Recorded before the guard so a failing call still counts as a call — that is what
        // proves a 502 was not cached.
        state.categoryRegions.push(params.regionCode!);
        await guard();
        return { data: { items: state.categories ?? [] } };
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
  auth: Auth;
  state: FakeState;
  /** Exposed so the socket tests can drive a push without going through an action. */
  events: StateEvents;
  regionCode: string;
  close: () => Promise<void>;
}

/**
 * `categories.ts` caches per region for the process lifetime, so every boot gets its own region
 * and the module cache cannot leak a result from one test into the next.
 */
let regionSeq = 0;

/** Boots the credentialed route table on an ephemeral port, exactly as server.ts wires it. */
async function boot(): Promise<Harness> {
  const regionCode = `R${regionSeq++}`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "api-integration-"));
  const store = new JsonStore(path.join(dir, "store.json"));
  await store.init();

  const state: FakeState = { broadcast: liveBroadcast(), categoryRegions: [] };
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
  const fills = new FillRequests(events);
  // No admin seeded: authentication is dormant, exactly as it is on a desktop/LAN install, so
  // every existing test below exercises the route table unchanged. The guarded-route tests seed
  // an admin through this handle to turn it on.
  const auth = new Auth(store);
  const audit = new AuditLog(path.join(dir, "audit.log"));
  const ctx: AppContext = {
    store,
    runner,
    cache,
    yt,
    quota,
    events,
    logger,
    fills,
    auth,
    audit,
    regionCode,
  };

  const app = express();
  app.use(express.json());
  mountAuditTrail(app, { audit, auth });
  // Mounted ahead of the route table, exactly as server.ts does — sign-in and setup have to
  // answer in setup mode too, so they cannot live inside mountApiRoutes.
  mountBootRoutes(app, {
    auth,
    setup: { store, configured: true, requestRestart: () => {} },
    appInfo: { version: "0.0.0-test", changelog: [] },
  });
  mountApiRoutes(app, ctx);

  const server = http.createServer(app);
  // Attached exactly as server.ts does, so the upgrade handling under test is the real one.
  const wss = attachStateSocket(server, ctx);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    store,
    auth,
    state,
    events,
    regionCode,
    close: async () => {
      // Sockets are dropped first: an open connection keeps server.close from ever calling back.
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
      // Audit entries are recorded from a response that has already been sent, so the last one is
      // still in flight when the request returns. Without this the rm below races it and fails
      // with ENOTEMPTY — the audit write recreates the file under the directory being removed.
      await audit.settled();
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
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Creates a preset through the API, so the tests exercise the same validation the UI does. */
async function createPreset(
  fields: Record<string, unknown> = {},
): Promise<string> {
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
    const id = await createPreset({
      title: "Jumu'ah",
      privacyStatus: "public",
    });
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
    expect(res.body.status).toMatchObject({
      title: "Original title",
      privacyStatus: "public",
    });
  });

  it("undoes the previous change", async () => {
    await call("POST", "/api/action/update", { title: "Mistake" });
    const res = await call("POST", "/api/action/undo");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      status: { title: "Original title" },
    });
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
    const off = await call("PUT", "/api/dashboard/service", {
      apiEnabled: false,
    });
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
    h.state.error = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
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
    const id = await createPreset({
      title: "Aliased",
      privacyStatus: "unlisted",
    });
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
    expect(res.body).toMatchObject({
      status: "auth_error",
      authenticated: false,
    });
  });

  it("serves the active-preset superset after a preset is applied", async () => {
    const id = await createPreset({
      title: "Fajr",
      slug: "FAJR",
      privacyStatus: "public",
    });
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
    expect(status.body).toEqual({
      title: null,
      privacyStatus: null,
      isLive: false,
    });
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

  it("serves the first paint from the shared builder, not a hand-rolled subset", async () => {
    // This route used to duplicate the payload by hand, so every field added to the contract was
    // missing until the next SSE push. Pin the assembled-only fields and the contract's full key
    // set so a future addition can't silently go missing on load.
    await call("POST", "/api/action/refresh");
    const state = await call("GET", "/api/dashboard/state");
    const refresh = await call("POST", "/api/action/refresh");

    expect(typeof state.body.displayLabel).toBe("string");
    expect(state.body).toHaveProperty("targetConflict");
    const { success, error, ...refreshState } = refresh.body;
    expect(Object.keys(state.body).sort()).toEqual(
      Object.keys(refreshState).sort(),
    );
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

    const bad = await call("POST", "/api/dashboard/presets", {
      privacyStatus: "public",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_REQUEST");

    expect((await call("DELETE", `/api/dashboard/presets/${id}`)).status).toBe(
      200,
    );
    expect((await call("DELETE", `/api/dashboard/presets/${id}`)).status).toBe(
      404,
    );
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
    expect(
      (await call("GET", "/api/dashboard/settings")).body.defaultCategory,
    ).toBe("22");

    const bad = await call("PUT", "/api/dashboard/settings", {
      defaultCategory: "",
    });
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
      {
        id: "s1",
        snippet: { title: "Main" },
        cdn: { ingestionInfo: { streamName: "key-1" } },
      },
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
    expect(
      entries.some((e: { message: string }) => e.message.includes("Logged")),
    ).toBe(true);
  });

  it("raises a fill request and broadcasts it — reads don't consume it", async () => {
    const id = await createPreset({ title: "Lesson {topic}" });

    const raised = await call("POST", "/api/dashboard/fill-request", {
      presetId: id,
    });
    expect(raised.status).toBe(200);
    expect(raised.body.success).toBe(true);

    // Every dashboard reads the same pending request off state; a read never clears it, so a
    // second surface (e.g. a phone over Tailscale) still sees it and pops its own popup.
    const first = await call("GET", "/api/dashboard/state");
    expect(first.body.fillRequest).toMatchObject({
      id: raised.body.id,
      presetId: id,
    });
    const second = await call("GET", "/api/dashboard/state");
    expect(second.body.fillRequest).toMatchObject({
      id: raised.body.id,
      presetId: id,
    });
  });

  it("rejects a fill request for an unknown preset in the 200 envelope", async () => {
    const res = await call("POST", "/api/dashboard/fill-request", {
      presetId: "ghost",
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("INVALID_PRESET");
  });

  it("round-trips the ntfy notify config and rejects a bad server URL", async () => {
    const put = await call("PUT", "/api/dashboard/notify", {
      ntfyServer: "",
      ntfyTopic: "masjid-fill",
      publicBaseUrl: "http://studio.tail1234.ts.net:8080",
    });
    expect(put.status).toBe(200);
    // Empty server falls back to the public default rather than persisting "".
    expect(put.body).toEqual({
      ntfyServer: "https://ntfy.sh",
      ntfyTopic: "masjid-fill",
      publicBaseUrl: "http://studio.tail1234.ts.net:8080",
    });
    expect((await call("GET", "/api/dashboard/notify")).body.ntfyTopic).toBe(
      "masjid-fill",
    );

    const bad = await call("PUT", "/api/dashboard/notify", {
      ntfyServer: "not a url",
      ntfyTopic: "",
      publicBaseUrl: "",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_REQUEST");
  });
});

/**
 * The pinned edit target, over real HTTP: choosing a broadcast has to actually change where the
 * next write lands, which is the only claim that matters and the one a unit test on resolveTarget
 * cannot make on its own.
 */
describe("edit target pin", () => {
  const idle = (id: string, title: string, hoursAhead: number) => ({
    id,
    snippet: {
      title,
      scheduledStartTime: new Date(
        Date.now() + hoursAhead * 3600_000,
      ).toISOString(),
      publishedAt: new Date().toISOString(),
    },
    status: { privacyStatus: "private", lifeCycleStatus: "created" },
    contentDetails: { boundStreamId: "s1" },
  });

  beforeEach(() => {
    // Idle channel with two indistinguishable-by-title events — the state that makes the app guess.
    h.state.broadcast = null;
    h.state.upcoming = [
      idle("soon", "Soonest", 1),
      idle("mine", "The one I want", 5),
    ];
  });

  it("offers every candidate and marks the one it would choose unaided", async () => {
    const res = await call("GET", "/api/dashboard/target/candidates");
    expect(res.status).toBe(200);
    expect(res.body.map((c: any) => c.id).sort()).toEqual(["mine", "soon"]);
    expect(res.body.find((c: any) => c.wouldPick).id).toBe("soon");
  });

  it("sends the write to the pinned broadcast instead of the automatic pick", async () => {
    // Unpinned, an update lands on the soonest event.
    await call("POST", "/api/action/update", { title: "before" });
    expect(h.state.upcoming!.find((b) => b.id === "soon")!.snippet!.title).toBe(
      "before",
    );

    await call("PUT", "/api/dashboard/target", {
      id: "mine",
      label: "The one I want",
    });
    const res = await call("POST", "/api/action/update", { title: "after" });
    expect(res.body.target.id).toBe("mine");
    expect(h.state.upcoming!.find((b) => b.id === "mine")!.snippet!.title).toBe(
      "after",
    );
    // The automatic pick keeps the earlier value — the pin moved the write, it did not fan out.
    expect(h.state.upcoming!.find((b) => b.id === "soon")!.snippet!.title).toBe(
      "before",
    );
  });

  it("surfaces the pin on dashboard state and clears it back to automatic", async () => {
    await call("PUT", "/api/dashboard/target", {
      id: "mine",
      label: "The one I want",
    });
    expect(
      (await call("GET", "/api/dashboard/state")).body.targetPin,
    ).toMatchObject({
      id: "mine",
      label: "The one I want",
    });

    await call("PUT", "/api/dashboard/target", { id: null });
    expect(
      (await call("GET", "/api/dashboard/state")).body.targetPin,
    ).toBeNull();
    expect(
      (await call("POST", "/api/action/update", { title: "auto" })).body.target
        .id,
    ).toBe("soon");
  });

  it("falls back to the automatic pick and reports the pin as gone when it is deleted", async () => {
    await call("PUT", "/api/dashboard/target", {
      id: "mine",
      label: "The one I want",
    });
    h.state.upcoming = h.state.upcoming!.filter((b) => b.id !== "mine");

    const res = await call("POST", "/api/action/update", {
      title: "recovered",
    });
    expect(res.body.target.id).toBe("soon");
    const state = await call("GET", "/api/dashboard/state");
    expect(state.body.targetConflict.code).toBe("PINNED_TARGET_GONE");
    // Left standing deliberately: only the operator clears it, so the banner cannot disappear
    // before they have seen it.
    expect(state.body.targetPin.id).toBe("mine");
  });

  it("does not report the operator's own pin as drift", async () => {
    // Distinct stream keys, so no other conflict can mask the drift check.
    h.state.upcoming = [
      {
        ...idle("soon", "Soonest", 1),
        contentDetails: { boundStreamId: "s-a" },
      },
      {
        ...idle("mine", "The one I want", 5),
        contentDetails: { boundStreamId: "s-b" },
      },
    ];
    // A refresh first, so the app has a target on record to compare against.
    await call("POST", "/api/action/refresh");
    await call("PUT", "/api/dashboard/target", {
      id: "mine",
      label: "The one I want",
    });
    // No second explicit refresh here: the PUT fires its own, and that first post-pin refresh is
    // exactly where the false banner appeared.
    await new Promise((r) => setTimeout(r, 50));

    // The target did change — because the operator said so. Reporting that back as "something
    // else is creating broadcasts, close Studio's stream page" accuses them of their own choice.
    const pinned = await call("GET", "/api/dashboard/state");
    expect(pinned.body.targetConflict).toBeNull();

    // Same on the way back to automatic.
    await call("PUT", "/api/dashboard/target", { id: null });
    await new Promise((r) => setTimeout(r, 50));
    const cleared = await call("GET", "/api/dashboard/state");
    expect(cleared.body.targetConflict?.code ?? null).not.toBe("TARGET_DRIFT");
    // Unpinned with two upcoming, the ordinary ambiguity warning is the only one expected.
    expect(cleared.body.targetConflict?.code ?? null).toBe("MULTIPLE_UPCOMING");
  });

  it("sorts candidates closest-to-air first, with no scheduled start last", async () => {
    h.state.upcoming = [
      {
        ...idle("undated", "No start time", 0),
        snippet: { title: "No start time" },
      },
      idle("later", "Later", 9),
      idle("mine", "The one I want", 5),
    ];
    const res = await call("GET", "/api/dashboard/target/candidates");
    // "soon" is gone from this list, so the automatic pick heads it; an event with no scheduled
    // start is the least identifiable row, not the most imminent one, so it sorts last.
    expect(res.body.map((c: any) => c.id)).toEqual([
      "mine",
      "later",
      "undated",
    ]);
  });

  it("rejects an empty id rather than storing an unusable pin", async () => {
    const res = await call("PUT", "/api/dashboard/target", { id: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REQUEST");
  });
});

describe("setup route under a configured boot", () => {
  it("reports configured without ever echoing a secret", async () => {
    await h.store.update((s) => {
      s.credentials = {
        clientId: "id",
        clientSecret: "sec",
        refreshToken: "1//tok",
      };
    });
    const res = await call("GET", "/api/setup/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      hasClientId: true,
      hasRefreshToken: true,
      // No browser to open in a headless boot, so the in-app OAuth flow is unavailable.
      connectMode: null,
    });
    expect(JSON.stringify(res.body)).not.toContain("1//tok");
  });
});

describe("categories route", () => {
  it("serves only assignable categories, sorted by title", async () => {
    h.state.categories = [
      { id: "24", snippet: { title: "Entertainment", assignable: true } },
      { id: "29", snippet: { title: "Nonprofits", assignable: false } },
      { id: "22", snippet: { title: "Blogs", assignable: true } },
    ];
    const res = await call("GET", "/api/dashboard/categories");
    expect(res.status).toBe(200);
    // Non-assignable is dropped: writing one back to a video is rejected by YouTube (PRD §6).
    expect(res.body).toEqual([
      { id: "22", title: "Blogs" },
      { id: "24", title: "Entertainment" },
    ]);
  });

  it("falls back to the id when a category carries no title", async () => {
    h.state.categories = [{ id: "17", snippet: { assignable: true } }];
    const res = await call("GET", "/api/dashboard/categories");
    // A blank row in the picker is worse than a numeric one — the operator can still pick it.
    expect(res.body).toEqual([{ id: "17", title: "17" }]);
  });

  it("asks YouTube once per region, then serves the cache", async () => {
    h.state.categories = [{ id: "22", snippet: { title: "Blogs", assignable: true } }];
    await call("GET", "/api/dashboard/categories");
    await call("GET", "/api/dashboard/categories");
    // The list is effectively static and costs a quota unit per call, so the second dashboard
    // load must not spend one.
    expect(h.state.categoryRegions).toEqual([h.regionCode]);
  });

  it("maps a YouTube failure to 502 with the error body", async () => {
    h.state.error = httpError(403, "quotaExceeded");
    const res = await call("GET", "/api/dashboard/categories");
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("YOUTUBE_QUOTA_EXCEEDED");
  });

  it("does not cache a failure — the next load retries", async () => {
    h.state.error = httpError(403, "quotaExceeded");
    expect((await call("GET", "/api/dashboard/categories")).status).toBe(502);
    h.state.error = undefined;
    h.state.categories = [{ id: "22", snippet: { title: "Blogs", assignable: true } }];
    const res = await call("GET", "/api/dashboard/categories");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "22", title: "Blogs" }]);
    expect(h.state.categoryRegions).toHaveLength(2);
  });
});

describe("webhook route", () => {
  it("reports no webhook on a fresh store", async () => {
    const res = await call("GET", "/api/dashboard/webhook");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: null });
  });

  it("stores a url and reads it back", async () => {
    const put = await call("PUT", "/api/dashboard/webhook", {
      url: "https://hooks.example.test/state",
    });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ url: "https://hooks.example.test/state" });
    // Persisted, not just echoed.
    expect((await call("GET", "/api/dashboard/webhook")).body.url).toBe(
      "https://hooks.example.test/state",
    );
    expect(h.store.get().webhook.url).toBe("https://hooks.example.test/state");
  });

  it("treats an empty string as clearing the webhook", async () => {
    await call("PUT", "/api/dashboard/webhook", { url: "https://hooks.example.test/state" });
    const res = await call("PUT", "/api/dashboard/webhook", { url: "" });
    expect(res.status).toBe(200);
    // Null, not "": the dispatcher tests `url` for truthiness, and an empty string would be
    // stored as a configured-but-unusable endpoint.
    expect(res.body).toEqual({ url: null });
  });

  it("clears through surrounding whitespace too", async () => {
    const res = await call("PUT", "/api/dashboard/webhook", { url: "   " });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: null });
  });

  it("rejects a value that is not a url and leaves the stored one alone", async () => {
    await call("PUT", "/api/dashboard/webhook", { url: "https://hooks.example.test/state" });
    const res = await call("PUT", "/api/dashboard/webhook", { url: "not a url" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REQUEST");
    expect(h.store.get().webhook.url).toBe("https://hooks.example.test/state");
  });

  it("rejects a body with no url field", async () => {
    const res = await call("PUT", "/api/dashboard/webhook", {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REQUEST");
  });
});

/** Opens a push socket and buffers every frame, so a test can assert silence as well as arrival. */
async function openSocket(path: string): Promise<{
  ws: WebSocket;
  frames: any[];
  settle: () => Promise<void>;
}> {
  const ws = new WebSocket(`${h.url.replace("http://", "ws://")}${path}`);
  const frames: any[] = [];
  ws.on("message", (data) => frames.push(JSON.parse(String(data))));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50));
  await settle();
  return { ws, frames, settle };
}

describe("state push socket", () => {
  it("sends the current state on connect", async () => {
    // The poll loop is off in the harness, so prime the cache: an empty envelope would pass an
    // assertion on shape alone and prove nothing.
    await call("POST", "/api/action/refresh");
    const { ws, frames } = await openSocket("/api/feedback/ws");
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("state");
    expect(frames[0].state.status.title).toBe("Original title");
    ws.close();
  });

  it("serves the dashboard base as the same stream", async () => {
    // Both bases are mounted deliberately, mirroring the two /action bases — a dashboard
    // pointed at the Companion path (or the reverse) must not get a dead socket.
    await call("POST", "/api/action/refresh");
    const { ws, frames } = await openSocket("/api/dashboard/ws");
    expect(frames).toHaveLength(1);
    expect(frames[0].state.status.title).toBe("Original title");
    ws.close();
  });

  it("refuses an unknown upgrade path", async () => {
    await expect(openSocket("/api/nope")).rejects.toBeTruthy();
  });

  it("pushes on a real change and stays quiet on a no-op tick", async () => {
    await call("POST", "/api/action/refresh");
    const { ws, frames, settle } = await openSocket("/api/feedback/ws");
    // Producers emit liberally; the socket dedupes by signature, so this must not reach anyone.
    h.events.emitChange();
    await settle();
    expect(frames).toHaveLength(1);

    await call("POST", "/api/action/update", { title: "Pushed" });
    await settle();
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.at(-1).state.status.title).toBe("Pushed");
    ws.close();
  });

  it("re-sends unchanged state when the client asks", async () => {
    await call("POST", "/api/action/refresh");
    const { ws, frames, settle } = await openSocket("/api/feedback/ws");
    // A button configured after connect pulls state on demand instead of waiting for a change;
    // the content of the frame is ignored.
    ws.send("resync");
    await settle();
    expect(frames).toHaveLength(2);
    expect(frames[1].state.status.title).toBe("Original title");
    ws.close();
  });

  it("stops rebuilding state once a client disconnects", async () => {
    const before = h.events.listenerCount("change");
    const { ws } = await openSocket("/api/feedback/ws");
    expect(h.events.listenerCount("change")).toBe(before + 1);
    ws.close();
    // Without the close teardown the subscription (and its heartbeat) leaks for the process life.
    await new Promise((r) => setTimeout(r, 100));
    expect(h.events.listenerCount("change")).toBe(before);
  });
});

/**
 * Issue 043's thin slice through the real route table: with an admin seeded, exactly one route
 * enforces a session and every other route behaves as it did before.
 */
describe("the guarded route", () => {
  /** Signs in through the real login route and returns the browser's Cookie header. */
  async function signIn(): Promise<string> {
    const res = await fetch(`${h.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "operator", password: "a-long-enough-secret" }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    return cookie!.split(";")[0];
  }

  /**
   * Every route a signed-out browser must still reach after issue 044 widened the guard across
   * `/api/dashboard/*`. What is left is Companion's, and stays open until issues 047 → 049 give
   * the module a token to carry.
   */
  const stillOpen = ["/api/feedback/health", "/api/feedback/status"];

  it("is open while no admin is seeded", async () => {
    expect((await call("GET", "/api/dashboard/settings")).status).toBe(200);
  });

  it("refuses a signed-out caller once an admin is seeded", async () => {
    await h.auth.seed({ name: "operator", password: "a-long-enough-secret" });
    const res = await call("GET", "/api/dashboard/settings");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("admits a signed-in caller, on reads and writes alike", async () => {
    await h.auth.seed({ name: "operator", password: "a-long-enough-secret" });
    const cookie = await signIn();
    const read = await fetch(`${h.url}/api/dashboard/settings`, { headers: { cookie } });
    expect(read.status).toBe(200);
    const write = await fetch(`${h.url}/api/dashboard/settings`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ defaultCategory: "20", defaultStreamBoundId: null }),
    });
    expect(write.status).toBe(200);
    expect(h.store.get().defaults.defaultCategory).toBe("20");
  });

  it("leaves the Companion-facing routes open — the guard stops at /api/dashboard", async () => {
    await h.auth.seed({ name: "operator", password: "a-long-enough-secret" });
    for (const route of stillOpen) {
      expect(`${route} → ${(await call("GET", route)).status}`).toBe(`${route} → 200`);
    }
    // Companion's action endpoints keep working too: the module holds no session and issue 049 is
    // what eventually gives it a token.
    expect((await call("POST", "/api/action/refresh")).status).toBe(200);
  });

  it("now refuses the rest of the dashboard too (issue 044)", async () => {
    await h.auth.seed({ name: "operator", password: "a-long-enough-secret" });
    // A sample here; guard.integration.test.ts is what walks the whole table.
    for (const route of ["/api/dashboard/presets", "/api/dashboard/state", "/api/dashboard/logs"]) {
      expect(`${route} → ${(await call("GET", route)).status}`).toBe(`${route} → 401`);
    }
  });
});
