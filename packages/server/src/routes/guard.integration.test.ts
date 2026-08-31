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
import WebSocket from "ws";
import { ADMIN_ONLY, GUARD_EXEMPTIONS, mountApiRoutes, mountBootRoutes, mountWebApp } from "../app.js";
import { createAccount } from "../auth/accounts.js";
import { attachStateSocket, WS_ROUTES } from "./socket.js";
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
/** A second account, so the role split can be probed rather than assumed (issue 045). */
const USER = { name: "camera", password: "another-long-secret", role: "user" as const };

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
      // `app.get(path)` accepts a string, a regexp, or an array of either.
      const paths: unknown[] = Array.isArray(layer.route.path)
        ? layer.route.path
        : [layer.route.path];
      for (const p of paths) {
        if (typeof p === "string") push(p, p);
        // The SPA catch-all is the one regexp route this app has, and it has no path to print,
        // so it is named. Any *other* non-string path is unrecognised — probed at "/" so it
        // answers 200 and lands in the audit's failure list rather than being waved through as
        // the exempt SPA.
        else if (String(p) === String(SPA_CATCHALL)) push("SPA", "/");
        else push(`unrecognised route ${String(p)}`, "/");
      }
      continue;
    }
    const mount = pathOfMount(layer.regexp);
    // A shape the reader below does not know. Probed at "/" for the same reason: an unreadable
    // mount must fail the audit, not disappear from it.
    if (mount === null) {
      push(`unparsed mount ${String(layer.regexp)}`, "/");
      continue;
    }
    // Global middleware (json parsing, express.static, the guard's own prefix layer) mounts at
    // "/" and is not a route table entry.
    if (mount === "" || mount === "/") continue;
    push(mount, `${mount}/__guard_audit__`);
  }
  return found;
}

/** The dashboard bundle's catch-all, as app.ts registers it. */
const SPA_CATCHALL = /^(?!\/api\/).*/;

/** `/^\/api\/dashboard\/logs\/?(?=\/|$)/i` → `/api/dashboard/logs`. */
function pathOfMount(regexp: RegExp): string | null {
  const m = /^\/\^(.*?)\\\/\?\(\?=\\\/\|\$\)\$?\/i?$/.exec(String(regexp));
  if (!m) return null;
  return m[1].replace(/\\(.)/g, "$1");
}

interface Harness {
  url: string;
  auth: Auth;
  store: JsonStore;
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
  if (seed) await createAccount(store, USER);

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
  // Attached exactly as server.ts does: the upgrade handler answers off the bare HTTP server,
  // below every express middleware, so it is the half of the surface the mount walk cannot see.
  const wss = attachStateSocket(server, ctx);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    auth,
    store,
    app,
    close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Opens a socket and reports how it went: "open" when the upgrade succeeded, or the HTTP status
 * the server refused it with. A refusal arrives as an `unexpected-server-response` error, not a
 * close frame — there is no socket to close in that case.
 */
async function upgrade(
  h: Harness,
  route: string,
  cookie?: string,
  headers: Record<string, string> = {},
): Promise<"open" | number> {
  const ws = new WebSocket(`${h.url.replace("http://", "ws://")}${route}`, {
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });
  try {
    return await new Promise<"open" | number>((resolve, reject) => {
      ws.once("open", () => resolve("open"));
      ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.once("error", (err) => {
        const status = /Unexpected server response: (\d+)/.exec(String(err))?.[1];
        if (status) resolve(Number(status));
        else reject(err);
      });
    });
  } finally {
    ws.close();
  }
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
async function signIn(h: Harness, who: { name: string; password: string } = ADMIN): Promise<string> {
  const res = await fetch(`${h.url}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: who.name, password: who.password }),
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

describe("the socket audit", () => {
  beforeEach(async () => {
    h = await boot(ADMIN);
  });

  it("guards every socket that is not an explicit, reasoned exemption", async () => {
    // The express walk above cannot see these: an upgrade is served off the HTTP server and runs
    // no middleware, so /api/dashboard/ws would otherwise have shipped open with the audit green.
    const open: string[] = [];
    for (const route of WS_ROUTES) {
      if (!route.guarded) continue;
      if ((await upgrade(h, route.path)) !== 401) open.push(route.path);
    }
    expect(open).toEqual([]);
  });

  it("gives every unguarded socket a stated reason", () => {
    expect(WS_ROUTES.filter((r) => !r.guarded && r.why.trim().length < 20)).toEqual([]);
  });

  it("leaves the Companion socket open, as its base is", async () => {
    expect(await upgrade(h, "/api/feedback/ws")).toBe("open");
  });

  it("lets the signed-in admin through", async () => {
    expect(await upgrade(h, "/api/dashboard/ws", await signIn(h))).toBe("open");
  });

  it("covers every path the upgrade handler answers on", () => {
    // The guard is only worth as much as this list: a socket added to socket.ts without an entry
    // here would be answered and never audited.
    expect(WS_ROUTES.map((r) => r.path).sort()).toEqual(["/api/dashboard/ws", "/api/feedback/ws"]);
  });
});

describe("device tokens at the handshake", () => {
  // The half of issue 047 the HTTP tests cannot reach. The module speaks both HTTP and this
  // socket, so a token checked on one and not the other guards nothing.
  beforeEach(async () => {
    h = await boot(ADMIN);
  });

  /**
   * Mints a token the way an admin would. Straight through the store rather than over HTTP: the
   * route that does this is covered in devices.integration.test.ts, and what these tests are
   * about is the *handshake*, not how the credential was obtained.
   */
  async function mint(name = "companion machine"): Promise<{ token: string; id: string }> {
    const admin = h.store.get().accounts.find((a) => a.role === "admin")!;
    const created = await h.auth.devices.create({ name, createdBy: admin.id });
    return { token: created.token, id: created.record.id };
  }

  it("admits a device token on the dashboard socket, which a cookie-only guard would refuse", async () => {
    const { token } = await mint();
    expect(await upgrade(h, "/api/dashboard/ws", undefined, { authorization: `Bearer ${token}` })).toBe(
      "open",
    );
  });

  it("still refuses a bad token, so the header is a check and not a bypass", async () => {
    expect(
      await upgrade(h, "/api/dashboard/ws", undefined, { authorization: "Bearer ytm_nonsense" }),
    ).toBe(401);
  });

  it("drops the live socket when the token is revoked", async () => {
    const { token, id } = await mint();
    const ws = new WebSocket(`${h.url.replace("http://", "ws://")}/api/dashboard/ws`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
    await h.auth.devices.revoke(id);
    h.auth.announceDeviceRevoked(id);

    // Not "on its next request": a Companion box opens one socket and holds it for weeks, so a
    // revocation that waits for a reconnect never takes effect at all.
    expect(await closed).toBe(4401);
  });

  it("records a tokenless Companion handshake rather than letting it pass unseen", async () => {
    expect(h.auth.grace.readout().tokenlessCount).toBe(0);
    expect(await upgrade(h, "/api/feedback/ws")).toBe("open");
    const g = h.auth.grace.readout();
    expect(g.tokenlessCount).toBe(1);
    expect(g.lastTokenlessRoute).toBe("/api/feedback/ws");
  });

  it("refuses a revoked token on the Companion endpoints instead of admitting it as tokenless", async () => {
    // The loophole revocation had: verify() returns null for a revoked token, and the guard read
    // that as "sent no token" and handed it the grace path. The box carried on running the show,
    // and its socket reconnected the moment the 4401 above cut it.
    const { token, id } = await mint();
    await h.auth.devices.revoke(id);
    const auth = { authorization: `Bearer ${token}` };

    const action = await fetch(`${h.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ action: "refresh" }),
    });
    await action.body?.cancel();
    expect(action.status).toBe(401);

    const feedback = await fetch(`${h.url}/api/feedback`, { headers: auth });
    await feedback.body?.cancel();
    expect(feedback.status).toBe(401);

    expect(await upgrade(h, "/api/feedback/ws", undefined, auth)).toBe(401);
    // And it is a refusal, not a recorded tokenless connection: the exit condition must not be
    // reset by a caller that did present a credential.
    expect(h.auth.grace.readout().tokenlessCount).toBe(0);
  });

  it("counts one tokenless SSE connect once, not once per guard the path matches", async () => {
    // /api/feedback/stream matches both the /api/feedback mount and its own app.get, so the
    // guard runs twice on it. It used to record twice, inflating the number the exit condition
    // is read from — the one thing the counter has to get right.
    expect(await probe(h, "/api/feedback/stream")).toBe(200);
    expect(h.auth.grace.readout().tokenlessCount).toBe(1);
  });

  it("refuses a tokenless handshake once enforcement is on, and admits a token", async () => {
    const { token } = await mint();
    await h.auth.grace.setEnforcing(true);
    expect(await upgrade(h, "/api/feedback/ws")).toBe(401);
    expect(
      await upgrade(h, "/api/feedback/ws", undefined, { authorization: `Bearer ${token}` }),
    ).toBe("open");
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

describe("the role audit", () => {
  // The second half of the same question the guard audit asks. That audit fixes the line between
  // signed-out and signed-in; this one fixes the line between a user and an admin, and it walks
  // the same real route table so an admin guard added without a listing — or a listing without a
  // guard — fails here rather than being discovered by whoever it locks out (issue 045).
  beforeEach(async () => {
    h = await boot(ADMIN);
  });

  it("refuses a user on every admin-only mount, and admits the admin", async () => {
    const user = await signIn(h, USER);
    const admin = await signIn(h);
    for (const entry of ADMIN_ONLY) {
      const route = `${entry.mount}/__guard_audit__`;
      expect(await probe(h, route, user), entry.mount).toBe(403);
      // Not asserting 200: the audit path is a route nobody serves. 403 is the only wrong answer.
      expect(await probe(h, route, admin), entry.mount).not.toBe(403);
    }
  });

  it("lets a user reach everything that is not listed — the show is theirs to run", async () => {
    const user = await signIn(h, USER);
    const admins = new Set(ADMIN_ONLY.map((e) => e.mount));
    const refused: string[] = [];
    for (const mount of mountsOf(h.app)) {
      if (admins.has(mount.label)) continue;
      if ((await probe(h, mount.probe, user)) === 403) refused.push(mount.label);
    }
    // Reads as the list of routes an admin quietly took away from the person running the stream.
    expect(refused).toEqual([]);
  });

  it("names real mounts, each with a stated reason", () => {
    const mounted = new Set(mountsOf(h.app).map((m) => m.label));
    expect(ADMIN_ONLY.map((e) => e.mount).filter((m) => !mounted.has(m))).toEqual([]);
    expect(ADMIN_ONLY.filter((e) => e.why.trim().length < 20)).toEqual([]);
    // Vacuity check, as above: an empty table would make both assertions pass saying nothing.
    expect(ADMIN_ONLY.length).toBeGreaterThan(0);
  });

  it("keeps the show-running routes open to a user", async () => {
    const user = await signIn(h, USER);
    for (const route of [
      "/api/dashboard/state",
      "/api/dashboard/presets",
      "/api/dashboard/settings",
      "/api/dashboard/target",
      "/api/dashboard/streams",
      "/api/dashboard/categories",
      "/api/dashboard/service",
      "/api/dashboard/app",
    ]) {
      expect(await probe(h, route, user), route).toBe(200);
    }
  });

  it("refuses a user the routes that could lose the channel or the server", async () => {
    const user = await signIn(h, USER);
    expect(await probe(h, "/api/setup/disconnect", user)).toBe(403);
    expect(await probe(h, "/api/dashboard/people", user)).toBe(403);
  });

  it("still tells a user whether YouTube is connected", async () => {
    // Read-only booleans, and the dashboard is built on them: the setup gate and the connection
    // card both read this. Hiding it would leave a user staring at a dashboard that cannot say
    // why nothing works.
    const user = await signIn(h, USER);
    expect(await probe(h, "/api/setup/status", user)).toBe(200);
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
    // Including the socket guard, which asks the same dormant question the express one does.
    expect(await upgrade(h, "/api/dashboard/ws")).toBe("open");
  });
});
