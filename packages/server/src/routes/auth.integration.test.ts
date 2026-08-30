import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../storage/jsonStore.js";
import { Auth, SESSION_COOKIE } from "../auth/actor.js";
import { authRouter } from "./auth.js";

/**
 * The sign-in chain over real HTTP (issue 043): an account exists, a person signs in, a session
 * proves who they are. The cookie is driven by hand rather than by a browser jar, because the
 * point of half these tests is exactly what the cookie carries.
 */

let dir: string;
let store: JsonStore;
let auth: Auth;
let server: http.Server;
let url: string;
let now: number;

async function boot(seed: { name: string; password: string } | null): Promise<void> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "auth-routes-"));
  store = new JsonStore(path.join(dir, "store.json"));
  await store.init();
  auth = new Auth(store, () => now);
  await auth.seed(seed);

  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter(auth));
  // Stands in for /api/dashboard/settings — the one route this slice actually guards.
  app.get("/api/dashboard/settings", auth.requireSession(), (_req, res) => res.json({ ok: true }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function call(
  method: string,
  route: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<{ status: number; body: any; cookies: string[] }> {
  const res = await fetch(`${url}${route}`, {
    method,
    headers: {
      ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, cookies: res.headers.getSetCookie() };
}

/** The `Cookie` header for the session in a Set-Cookie response. */
function cookieFrom(cookies: string[]): string {
  const jar = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return jar!.split(";")[0];
}

beforeEach(() => {
  now = Date.UTC(2026, 0, 1);
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await fs.rm(dir, { recursive: true, force: true });
});

describe("the sign-in chain", () => {
  it("signs in with the seeded credential and reaches the guarded route", async () => {
    await boot({ name: "operator", password: "a-long-enough-secret" });
    expect((await call("GET", "/api/dashboard/settings")).status).toBe(401);

    const signIn = await call("POST", "/api/auth/login", {
      body: { name: "operator", password: "a-long-enough-secret" },
    });
    expect(signIn.status).toBe(200);
    expect(signIn.body.account).toMatchObject({ name: "operator", role: "admin" });

    const guarded = await call("GET", "/api/dashboard/settings", {
      cookie: cookieFrom(signIn.cookies),
    });
    expect(guarded.status).toBe(200);
  });

  it("signs out, and the cookie stops working", async () => {
    await boot({ name: "operator", password: "a-long-enough-secret" });
    const signIn = await call("POST", "/api/auth/login", {
      body: { name: "operator", password: "a-long-enough-secret" },
    });
    const cookie = cookieFrom(signIn.cookies);

    const out = await call("POST", "/api/auth/logout", { cookie });
    expect(out.status).toBe(200);
    // The browser is told to drop it, and the server no longer honours it either.
    expect(out.cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=;`))).toBe(true);
    expect((await call("GET", "/api/dashboard/settings", { cookie })).status).toBe(401);
  });

  it("says the same thing for a wrong password as for an account that does not exist", async () => {
    await boot({ name: "operator", password: "a-long-enough-secret" });
    const wrong = await call("POST", "/api/auth/login", {
      body: { name: "operator", password: "not-the-password" },
    });
    const ghost = await call("POST", "/api/auth/login", {
      body: { name: "someone-else", password: "not-the-password" },
    });
    expect(wrong.status).toBe(401);
    expect(ghost.status).toBe(401);
    expect(wrong.body).toEqual(ghost.body);
    expect(wrong.cookies).toHaveLength(0);
  });

  it("rate-limits repeated failures and says when to try again", async () => {
    await boot({ name: "operator", password: "a-long-enough-secret" });
    for (let i = 0; i < 5; i++) {
      await call("POST", "/api/auth/login", { body: { name: "operator", password: "guess" } });
    }
    const blocked = await call("POST", "/api/auth/login", {
      body: { name: "operator", password: "a-long-enough-secret" },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("rejects a malformed sign-in payload", async () => {
    await boot({ name: "operator", password: "a-long-enough-secret" });
    const res = await call("POST", "/api/auth/login", { body: { name: "operator" } });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/auth/me", () => {
  it("reports an anonymous caller on a deployment that authenticates", async () => {
    await boot({ name: "operator", password: "a-long-enough-secret" });
    const res = await call("GET", "/api/auth/me");
    expect(res.body).toEqual({
      authRequired: true,
      authenticated: false,
      account: null,
      expiringSoon: false,
      absoluteExpiresAt: null,
    });
  });

  it("names the signed-in account without ever exposing its password hash", async () => {
    await boot({ name: "operator", password: "a-long-enough-secret" });
    const signIn = await call("POST", "/api/auth/login", {
      body: { name: "operator", password: "a-long-enough-secret" },
    });
    const res = await call("GET", "/api/auth/me", { cookie: cookieFrom(signIn.cookies) });
    expect(res.body.authenticated).toBe(true);
    expect(res.body.account).toEqual({
      id: store.get().accounts[0].id,
      name: "operator",
      role: "admin",
    });
    expect(JSON.stringify(res.body)).not.toContain("scrypt");
  });

  it("reports authentication as dormant when the deployment seeded no admin", async () => {
    // A desktop or LAN install: nothing to sign into, and the dashboard shows no login screen.
    await boot(null);
    const res = await call("GET", "/api/auth/me");
    expect(res.body.authRequired).toBe(false);
    expect((await call("GET", "/api/dashboard/settings")).status).toBe(200);
  });
});

describe("re-authentication near the 90-day cap", () => {
  it("flags an expiring session and issues a fresh absolute clock", async () => {
    await boot({ name: "operator", password: "a-long-enough-secret" });
    const signIn = await call("POST", "/api/auth/login", {
      body: { name: "operator", password: "a-long-enough-secret" },
    });
    let cookie = cookieFrom(signIn.cookies);

    // Eighty-five days of daily use: the idle clock keeps being refreshed, the cap does not move.
    for (let day = 0; day < 85; day++) {
      now += 24 * 60 * 60 * 1000;
      await call("GET", "/api/auth/me", { cookie });
    }
    const warned = await call("GET", "/api/auth/me", { cookie });
    expect(warned.body.expiringSoon).toBe(true);

    const renewed = await call("POST", "/api/auth/reauth", { cookie });
    expect(renewed.status).toBe(200);
    cookie = cookieFrom(renewed.cookies);
    const after = await call("GET", "/api/auth/me", { cookie });
    expect(after.body.authenticated).toBe(true);
    expect(after.body.expiringSoon).toBe(false);
  });

  it("refuses to re-authenticate a caller with no valid session", async () => {
    await boot({ name: "operator", password: "a-long-enough-secret" });
    expect((await call("POST", "/api/auth/reauth")).status).toBe(401);
  });
});
