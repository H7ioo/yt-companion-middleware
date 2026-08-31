import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../storage/jsonStore.js";
import { Auth, readCookie, SESSION_COOKIE, setSessionCookie } from "./actor.js";
import { createAccount } from "./accounts.js";

let dir: string;
let store: JsonStore;
let server: http.Server;
let base: string;

/** Fires a request at the test app, returning status plus any Set-Cookie headers. */
async function call(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: any; cookies: string[] }> {
  const res = await fetch(`${base}${url}`, init);
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    cookies: res.headers.getSetCookie(),
  };
}

/** Boots an express app with one guarded route, over the given Auth. */
async function serve(auth: Auth): Promise<void> {
  const app = express();
  app.use(express.json());
  app.get("/guarded", auth.requireSession(), (req, res) => {
    res.json({ who: auth.actorOf(req)?.account.name ?? null });
  });
  app.get(
    "/admin-only",
    auth.requireSession(),
    auth.requireAdmin(),
    (req, res) => res.json({ who: auth.actorOf(req)?.account.name ?? null }),
  );
  app.get("/open", (_req, res) => res.json({ ok: true }));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "actor-"));
  store = new JsonStore(path.join(dir, "store.json"));
  await store.init();
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

describe("the guarded route", () => {
  it("refuses a caller with no session", async () => {
    const auth = new Auth(store);
    await auth.seed({ name: "operator", password: "a-long-enough-secret" });
    await serve(auth);
    const res = await call("/guarded");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("admits a caller holding a session, and knows who they are", async () => {
    const auth = new Auth(store);
    await auth.seed({ name: "operator", password: "a-long-enough-secret" });
    await serve(auth);
    const signIn = await auth.signIn("operator", "a-long-enough-secret", "1.2.3.4");
    expect(signIn.ok).toBe(true);
    const res = await call("/guarded", {
      headers: { cookie: `${SESSION_COOKIE}=${(signIn as any).token}` },
    });
    expect(res.status).toBe(200);
    expect(res.body.who).toBe("operator");
  });

  it("refuses a session that has since been signed out", async () => {
    const auth = new Auth(store);
    await auth.seed({ name: "operator", password: "a-long-enough-secret" });
    await serve(auth);
    const signIn = (await auth.signIn("operator", "a-long-enough-secret", "1.2.3.4")) as any;
    await auth.sessions.revoke(signIn.token);
    const res = await call("/guarded", {
      headers: { cookie: `${SESSION_COOKIE}=${signIn.token}` },
    });
    expect(res.status).toBe(401);
  });

  it("leaves unguarded routes open", async () => {
    const auth = new Auth(store);
    await auth.seed({ name: "operator", password: "a-long-enough-secret" });
    await serve(auth);
    expect((await call("/open")).status).toBe(200);
  });

  it("passes everyone through when the deployment has no accounts", async () => {
    // The desktop/LAN install this app ships as today: nothing is seeded, so nothing locks.
    const auth = new Auth(store);
    await auth.seed(null);
    await serve(auth);
    expect(auth.required).toBe(false);
    expect((await call("/guarded")).status).toBe(200);
  });
});

describe("the admin-only route", () => {
  /** Signs someone in and returns their Cookie header. */
  async function cookieFor(auth: Auth, name: string, password: string): Promise<string> {
    const signIn = await auth.signIn(name, password, "1.2.3.4");
    if (!signIn.ok) throw new Error(`could not sign ${name} in`);
    return `${SESSION_COOKIE}=${signIn.token}`;
  }

  it("admits an admin", async () => {
    const auth = new Auth(store);
    await auth.seed({ name: "operator", password: "a-long-enough-secret" });
    await serve(auth);
    const res = await call("/admin-only", {
      headers: { cookie: await cookieFor(auth, "operator", "a-long-enough-secret") },
    });
    expect(res.status).toBe(200);
    expect(res.body.who).toBe("operator");
  });

  it("refuses a signed-in user, and says so rather than pretending they are signed out", async () => {
    // 403, not 401: a 401 would send the dashboard to the login screen, where signing in again
    // as the same person changes nothing. The person is known; the answer is no.
    const auth = new Auth(store);
    await auth.seed({ name: "operator", password: "a-long-enough-secret" });
    await createAccount(store, { name: "camera", password: "another-long-secret", role: "user" });
    await serve(auth);
    const res = await call("/admin-only", {
      headers: { cookie: await cookieFor(auth, "camera", "another-long-secret") },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("refuses a caller with no session at all", async () => {
    const auth = new Auth(store);
    await auth.seed({ name: "operator", password: "a-long-enough-secret" });
    await serve(auth);
    expect((await call("/admin-only")).status).toBe(401);
  });

  it("passes everyone through when the deployment has no accounts", async () => {
    // The desktop/LAN install again: one operator, no accounts, and nobody to be an admin.
    const auth = new Auth(store);
    await auth.seed(null);
    await serve(auth);
    expect((await call("/admin-only")).status).toBe(200);
  });
});

describe("signing in", () => {
  it("refuses an unknown account and a wrong password identically", async () => {
    const auth = new Auth(store);
    await auth.seed({ name: "operator", password: "a-long-enough-secret" });
    await serve(auth);
    const wrongPassword = await auth.signIn("operator", "nope", "1.2.3.4");
    const noSuchAccount = await auth.signIn("ghost", "nope", "5.6.7.8");
    expect(wrongPassword).toEqual({ ok: false, reason: "invalid" });
    expect(noSuchAccount).toEqual({ ok: false, reason: "invalid" });
  });

  it("throttles a caller who keeps guessing, then keeps refusing the right password", async () => {
    const auth = new Auth(store);
    await auth.seed({ name: "operator", password: "a-long-enough-secret" });
    await serve(auth);
    for (let i = 0; i < 5; i++) await auth.signIn("operator", "guess", "1.2.3.4");
    const blocked = await auth.signIn("operator", "a-long-enough-secret", "1.2.3.4");
    expect(blocked.ok).toBe(false);
    expect((blocked as any).reason).toBe("throttled");
  });

  it("throttles the guesser without locking out the same account from elsewhere", async () => {
    const auth = new Auth(store);
    await auth.seed({ name: "operator", password: "a-long-enough-secret" });
    await serve(auth);
    for (let i = 0; i < 6; i++) await auth.signIn("operator", "guess", "9.9.9.9");
    const fromHome = await auth.signIn("operator", "a-long-enough-secret", "1.2.3.4");
    expect(fromHome.ok).toBe(true);
  });
});

describe("the sliding session cookie", () => {
  it("re-stamps the cookie's lifetime on every authenticated request", async () => {
    // Twenty days in, the browser's copy of the cookie would be ten days from expiry if it were
    // only ever written at sign-in — while the server's idle clock, refreshed all along, is a
    // full thirty days out. The cookie has to follow the server, or the session dies at day 30
    // and the 90-day cap is never reached.
    let now = Date.UTC(2026, 0, 1);
    const auth = new Auth(store, () => now);
    await auth.seed({ name: "operator", password: "a-long-enough-secret" });
    await serve(auth);
    const signedIn = await auth.signIn("operator", "a-long-enough-secret", "1.2.3.4");
    const token = signedIn.ok ? signedIn.token : "";

    now += 20 * 24 * 60 * 60 * 1000;
    const res = await call("/guarded", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.status).toBe(200);
    const maxAge = Number(/Max-Age=(\d+)/.exec(res.cookies[0] ?? "")?.[1]);
    expect(maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("never stamps the cookie past the absolute cap", async () => {
    // Day 75 of 90: fifteen days of session left, so fifteen days of cookie — not thirty.
    let now = Date.UTC(2026, 0, 1);
    const auth = new Auth(store, () => now);
    await auth.seed({ name: "operator", password: "a-long-enough-secret" });
    await serve(auth);
    const signedIn = await auth.signIn("operator", "a-long-enough-secret", "1.2.3.4");
    const token = signedIn.ok ? signedIn.token : "";

    // Stepped, not jumped: a 75-day leap would blow past the 30-day idle window. This is a
    // browser in ordinary use, which is the only way to reach the cap at all.
    let res = await call("/guarded", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    for (let day = 20; day <= 75; day += day === 60 ? 15 : 20) {
      now = Date.UTC(2026, 0, 1) + day * 24 * 60 * 60 * 1000;
      res = await call("/guarded", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    }
    expect(res.status).toBe(200);
    const maxAge = Number(/Max-Age=(\d+)/.exec(res.cookies[0] ?? "")?.[1]);
    expect(maxAge).toBe(15 * 24 * 60 * 60);
  });
});

describe("the session cookie", () => {
  it("is httpOnly, SameSite and scoped to the whole app", async () => {
    const auth = new Auth(store);
    await auth.seed({ name: "operator", password: "a-long-enough-secret" });
    const app = express();
    app.use(express.json());
    app.get("/issue", (req, res) => {
      setSessionCookie(req, res, "a-token");
      res.json({ ok: true });
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}`;

    const [cookie] = (await call("/issue")).cookies;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    // Plain HTTP here, so no Secure flag — it would make the cookie unusable on a LAN install.
    expect(cookie).not.toContain("Secure");
  });

  it("is marked Secure when the request reached the origin over TLS through a trusted proxy", async () => {
    const auth = new Auth(store);
    await auth.seed(null);
    const app = express();
    // What a hosted boot sets from TRUST_PROXY; without it the forwarded scheme is ignored.
    app.set("trust proxy", true);
    app.get("/issue", (req, res) => {
      setSessionCookie(req, res, "a-token");
      res.json({ ok: true });
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}`;

    const [cookie] = (await call("/issue", { headers: { "x-forwarded-proto": "https" } })).cookies;
    expect(cookie).toContain("Secure");
  });

  it("ignores a forwarded scheme when no proxy is trusted", async () => {
    const auth = new Auth(store);
    await auth.seed(null);
    const app = express();
    app.get("/issue", (req, res) => {
      setSessionCookie(req, res, "a-token");
      res.json({ ok: true });
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}`;

    // Anyone can write this header. On a directly reachable server it must not flip the flag —
    // a Secure cookie on a plain-HTTP LAN install is a cookie the browser drops.
    const [cookie] = (await call("/issue", { headers: { "x-forwarded-proto": "https" } })).cookies;
    expect(cookie).not.toContain("Secure");
  });
});

describe("readCookie", () => {
  it("picks one cookie out of a header full of them", () => {
    expect(readCookie("a=1; yt_session=abc; b=2", SESSION_COOKIE)).toBe("abc");
  });

  it("does not confuse a cookie whose name merely ends the same way", () => {
    expect(readCookie("not_yt_session=wrong", SESSION_COOKIE)).toBeUndefined();
  });

  it("returns nothing for an absent header or absent cookie", () => {
    expect(readCookie(undefined, SESSION_COOKIE)).toBeUndefined();
    expect(readCookie("a=1", SESSION_COOKIE)).toBeUndefined();
  });
});
