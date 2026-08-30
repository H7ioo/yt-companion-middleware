import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { youtube_v3 } from "googleapis";
import { JsonStore } from "../storage/jsonStore.js";
import { StateCache } from "../core/stateCache.js";
import { ActionRunner } from "../core/actionRunner.js";
import { QuotaTracker } from "../core/quota.js";
import { StateEvents } from "../core/events.js";
import { Logger } from "../core/logger.js";
import { FillRequests } from "../core/fillRequests.js";
import { GUARD_EXEMPTIONS, mountApiRoutes, mountBootRoutes, mountWebApp } from "../app.js";
import { mountDocsRoutes } from "./docs.js";
import type { AppContext } from "./context.js";
import { Auth, SESSION_COOKIE } from "../auth/actor.js";

/**
 * The guard audit (issue 044). Not a list of routes someone remembered to test: it walks the
 * **real** mounted route table and requires every mount to be either behind the session guard or
 * named in `GUARD_EXEMPTIONS` with a reason. A route added without either fails here rather than
 * shipping open, which is the whole point of the slice (PRD-05 §2.1, PRD-15 §6).
 */

const ADMIN = { name: "operator", password: "a-long-enough-secret" };

/** One mount as express recorded it, recovered from the layer it built. */
interface Mount {
  /** The path to aim a request at. */
  probe: string;
  /** How it reads in a failure message and in GUARD_EXEMPTIONS. */
  label: string;
}

/**
 * Recovers the mount table from a built express app. Express 4 keeps no copy of the original
 * path string, so `app.use("/a/b", …)` has to be read back out of the layer's regexp — the
 * escaping is mechanical and the alternative (a hand-maintained list) is exactly the drift this
 * test exists to catch.
 */
function mountsOf(app: Express): Mount[] {
  const found: Mount[] = [];
  const seen = new Set<string>();
  const push = (label: string, probe: string): void => {
    if (seen.has(label)) return;
    seen.add(label);
    found.push({ label, probe });
  };

  for (const layer of (app as any)._router.stack as any[]) {
    if (layer.route) {
      const p = layer.route.path;
      // A regex route — only the SPA catch-all. It has no path to print, so it is named.
      if (typeof p !== "string") push("SPA", "/");
      else push(p, p);
      continue;
    }
    const mount = pathOfMount(layer.regexp);
    // Global middleware (json parsing, express.static, the guard's own prefix layer) mounts at
    // "/" and is not a route table entry.
    if (!mount || mount === "/") continue;
    push(mount, `${mount}/__guard_audit__`);
  }
  return found;
}

/** `/^\/api\/dashboard\/logs\/?(?=\/|$)/i` → `/api/dashboard/logs`. */
function pathOfMount(regexp: RegExp): string | null {
  const m = /^\/\^(.*?)\\\/\?\(\?=\\\/\|\$\)\$?\/i?$/.exec(String(regexp));
  if (!m) return null;
  return m[1].replace(/\\(.)/g, "$1");
}

interface Harness {
  url: string;
  auth: Auth;
  app: Express;
  close: () => Promise<void>;
}

/** Boots the whole route table — boot routes, credentialed routes, docs and the SPA. */
async function boot(seed: { name: string; password: string } | null): Promise<Harness> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "guard-audit-"));
  const store = new JsonStore(path.join(dir, "store.json"));
  await store.init();
  const auth = new Auth(store);
  await auth.seed(seed);

  const events = new StateEvents();
  const logger = new Logger();
  const quota = new QuotaTracker(store, 10_000, events, logger);
  quota.init();
  const yt = {
    liveBroadcasts: { list: async () => ({ data: { items: [] } }) },
    liveStreams: { list: async () => ({ data: { items: [] } }) },
    videoCategories: { list: async () => ({ data: { items: [] } }) },
  } as unknown as youtube_v3.Youtube;
  // Never started: this test asks who may reach a route, not what it answers.
  const cache = new StateCache(
    yt,
    store,
    { refreshIntervalMs: 60_000, healthFailureThreshold: 3 },
    events,
    logger,
  );
  const runner = new ActionRunner(yt, store, cache, events, logger);
  const ctx: AppContext = {
    store,
    runner,
    cache,
    yt,
    quota,
    events,
    logger,
    fills: new FillRequests(events),
    auth,
    regionCode: "US",
  };

  // A stand-in dashboard build, so the SPA catch-all is really mounted and really answers.
  const webDist = path.join(dir, "web");
  await fs.mkdir(webDist);
  await fs.writeFile(path.join(webDist, "index.html"), "<!doctype html><title>dashboard</title>");
  const docsDir = path.join(dir, "public");
  await fs.mkdir(docsDir);
  await fs.writeFile(path.join(docsDir, "guide.html"), "<!doctype html><title>guide</title>");
  await fs.writeFile(path.join(docsDir, "docs.html"), "<!doctype html><title>docs</title>");

  const app = express();
  app.use(express.json());
  // The same order server.ts mounts in — the order is half of what the audit is checking.
  mountBootRoutes(app, {
    auth,
    setup: { store, configured: true, requestRestart: () => {} },
    appInfo: { version: "9.9.9", changelog: [] },
  });
  mountApiRoutes(app, ctx);
  mountDocsRoutes(app, docsDir);
  mountWebApp(app, webDist);

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    auth,
    app,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Status only. The body is never read: two of these mounts are SSE streams that would hold the
 * response open forever, and the status line is the entire question anyway.
 */
async function probe(h: Harness, route: string, cookie?: string): Promise<number> {
  const res = await fetch(`${h.url}${route}`, { headers: cookie ? { cookie } : {} });
  await res.body?.cancel();
  return res.status;
}

/** Signs the seeded admin in and returns the `Cookie` header for their session. */
async function signIn(h: Harness): Promise<string> {
  const res = await fetch(`${h.url}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ADMIN),
  });
  await res.text();
  const jar = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return jar!.split(";")[0];
}

let h: Harness;
afterEach(async () => {
  await h?.close();
});

describe("the route-table audit", () => {
  beforeEach(async () => {
    h = await boot(ADMIN);
  });

  it("guards every mount that is not an explicit, reasoned exemption", async () => {
    const exempt = new Set(GUARD_EXEMPTIONS.map((e) => e.mount));
    const open: string[] = [];
    for (const mount of mountsOf(h.app)) {
      if (exempt.has(mount.label)) continue;
      if ((await probe(h, mount.probe)) !== 401) open.push(mount.label);
    }
    // Reads as the list of routes a signed-out stranger can reach without anyone having said so.
    expect(open).toEqual([]);
  });

  it("has no stale exemptions — every one names a mount that exists", () => {
    const mounted = new Set(mountsOf(h.app).map((m) => m.label));
    expect(GUARD_EXEMPTIONS.map((e) => e.mount).filter((m) => !mounted.has(m))).toEqual([]);
  });

  it("gives every exemption a stated reason", () => {
    expect(GUARD_EXEMPTIONS.filter((e) => e.why.trim().length < 20)).toEqual([]);
  });

  it("sees the mounts it thinks it sees", () => {
    // Guards the audit itself: a regexp-parsing slip that returned an empty table would make
    // every assertion above pass vacuously.
    const labels = mountsOf(h.app).map((m) => m.label);
    expect(labels).toContain("/api/dashboard/logs");
    expect(labels).toContain("/api/feedback/health");
    expect(labels).toContain("SPA");
    expect(labels.length).toBeGreaterThan(15);
  });
});

describe("what a signed-out browser can reach", () => {
  beforeEach(async () => {
    h = await boot(ADMIN);
  });

  it("refuses every dashboard route", async () => {
    for (const route of [
      "/api/dashboard/state",
      "/api/dashboard/settings",
      "/api/dashboard/presets",
      "/api/dashboard/categories",
      "/api/dashboard/streams",
      "/api/dashboard/target",
      "/api/dashboard/webhook",
      "/api/dashboard/service",
      "/api/dashboard/logs",
      "/api/dashboard/notify",
      "/api/dashboard/fill-request",
      "/api/dashboard/stream",
      "/api/dashboard/action/refresh",
      "/api/dashboard/app",
    ]) {
      expect(await probe(h, route), route).toBe(401);
    }
  });

  it("still answers the liveness probe Companion polls", async () => {
    expect(await probe(h, "/api/feedback/health")).toBe(200);
  });

  it("still serves the login page — the catch-all is what hands it over", async () => {
    expect(await probe(h, "/")).toBe(200);
    expect(await probe(h, "/anything-the-spa-routes")).toBe(200);
  });

  it("leaves the Companion endpoints exactly as they were", async () => {
    // Not 401: guarding these before the module can carry a token is the outage in PRD-15 §4.
    // 200-with-an-error-body is the action bus's envelope contract (PRD-01 §7).
    const res = await fetch(`${h.url}/api/action/preset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId: "nope" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { success: boolean }).toMatchObject({ success: false });
    expect(await probe(h, "/api/feedback/status")).not.toBe(401);
  });

  it("refuses setup, so a stranger who finds the host first cannot claim it", async () => {
    expect(await probe(h, "/api/setup/status")).toBe(401);
  });
});

describe("what the seeded admin can reach", () => {
  beforeEach(async () => {
    h = await boot(ADMIN);
  });

  it("reaches setup, app info and the dashboard", async () => {
    const cookie = await signIn(h);
    expect(await probe(h, "/api/setup/status", cookie)).toBe(200);
    expect(await probe(h, "/api/dashboard/app", cookie)).toBe(200);
    expect(await probe(h, "/api/dashboard/state", cookie)).toBe(200);
    expect(await probe(h, "/api/dashboard/settings", cookie)).toBe(200);
  });
});

describe("a deployment with no accounts", () => {
  beforeEach(async () => {
    h = await boot(null);
  });

  it("locks nothing — the desktop and LAN installs are untouched", async () => {
    // The switch from issue 043. Widening the guard is only safe because of it, so the audit
    // above is worth nothing without this test beside it.
    expect(h.auth.required).toBe(false);
    for (const route of [
      "/api/setup/status",
      "/api/dashboard/app",
      "/api/dashboard/state",
      "/api/dashboard/settings",
      "/api/dashboard/logs",
      "/api/feedback/health",
    ]) {
      expect(await probe(h, route), route).toBe(200);
    }
  });
});
