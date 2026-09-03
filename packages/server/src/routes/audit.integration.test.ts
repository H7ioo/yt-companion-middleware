import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../storage/jsonStore.js";
import { Auth, SESSION_COOKIE } from "../auth/actor.js";
import { createAccount } from "../auth/accounts.js";
import { AuditLog } from "../audit/log.js";
import { auditTrail } from "../audit/middleware.js";
import { auditRouter } from "./audit.js";
import { peopleRouter } from "./people.js";
import { devicesRouter } from "./devices.js";
import { setupCallbackHandler } from "./setup.js";
import { requireConnectCallback } from "../app.js";
import { AppError } from "../core/errors.js";
import type { AuditEntry } from "@app/shared";

/**
 * The audit trail at the HTTP surface (issue 050, PRD-15 §3).
 *
 * Mounted the way app.ts and server.ts mount it, because half of what is under test *is* the
 * mounting: recording is one middleware ahead of every route rather than a line inside each one,
 * and the actor it names comes off the request the guard resolved.
 */

const ADMIN = { name: "operator", password: "a-long-enough-secret" };
const USER = { name: "camera", password: "another-long-secret", role: "user" as const };

let dir: string;
let store: JsonStore;
let auth: Auth;
let audit: AuditLog;
let server: http.Server;
let base: string;

async function call(url: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${url}`, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** A browser navigation, which answers with a redirect and no JSON body to parse. */
async function navigate(url: string, cookie: string): Promise<number> {
  const res = await fetch(`${base}${url}`, { redirect: "manual", headers: { cookie } });
  await res.body?.cancel();
  return res.status;
}

async function cookieFor(who: { name: string; password: string }): Promise<string> {
  const signIn = await auth.signIn(who.name, who.password, "1.2.3.4");
  if (!signIn.ok) throw new Error(`could not sign ${who.name} in`);
  return `${SESSION_COOKIE}=${signIn.token}`;
}

async function asAdmin(url: string, init: RequestInit = {}) {
  return call(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie: await cookieFor(ADMIN),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

/**
 * Waits for the trail to catch up. Recording happens after the response has been sent — that is
 * the point of it — so a test that reads immediately is racing the write, not testing it.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await audit.settled();
}

/** The entries the viewer reports, newest first. */
async function entries(query = ""): Promise<AuditEntry[]> {
  await flush();
  const res = await asAdmin(`/api/dashboard/audit${query}`);
  expect(res.status).toBe(200);
  return res.body.entries as AuditEntry[];
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-http-"));
  store = new JsonStore(path.join(dir, "store.json"));
  await store.init();
  auth = new Auth(store);
  await auth.seed(ADMIN);
  await createAccount(store, USER);
  audit = new AuditLog(path.join(dir, "audit.log"));

  const app = express();
  app.use(express.json());
  // The trail goes on before every route, as server.ts does it.
  app.use(auditTrail({ audit, auth }));
  app.use(
    "/api/dashboard/people",
    auth.requireSession(),
    auth.requireAdmin(),
    peopleRouter({ store, auth }),
  );
  app.use(
    "/api/dashboard/devices",
    auth.requireSession(),
    auth.requireAdmin(),
    devicesRouter({ store, auth }),
  );
  app.use("/api/dashboard/audit", auth.requireSession(), auth.requireAdmin(), auditRouter({ audit }));
  // Stand-ins for the two halves of the show-running surface: the Companion base and a settings
  // write. Behind the same guards their real mounts carry.
  app.post("/api/action/preset", auth.requireCompanion(), (_req, res) => {
    res.json({ ok: true });
  });
  app.put("/api/dashboard/settings", auth.requireSession(), (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/dashboard/settings", auth.requireSession(), (_req, res) => {
    res.json({ ok: true });
  });
  // A stand-in for the setup route, which takes a Google client ID and secret.
  app.post("/api/setup", auth.requireSession(), auth.requireAdmin(), (_req, res) => {
    res.json({ ok: true });
  });
  // The hosted connect callback, mounted the way app.ts mounts it. The real handler, because
  // what is under test is that a *GET* which replaces the channel's credentials is recorded —
  // and recorded as what it was, since success and failure both leave as a 302 (issue 052).
  app.get(
    "/api/setup/oauth/callback",
    requireConnectCallback(auth),
    setupCallbackHandler({
      store,
      configured: false,
      requestRestart: () => {},
      hosted: {
        redirectUri: "https://live.example.org/api/setup/oauth/callback",
        authorize: () => ({ url: "https://accounts.google.com/o/oauth2/v2/auth" }),
        complete: async ({ code }) => {
          if (code !== "good-code") throw new AppError("OAUTH_FAILED", "Google refused the sign-in.");
        },
      },
    }),
  );

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Recording happens after the response has gone, so an append can still be in flight — pulling
  // the directory out from under it is an ENOTEMPTY that has nothing to do with the test.
  await audit.settled();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("what gets recorded", () => {
  it("writes exactly one entry per mutating action, naming the person who did it", async () => {
    const target = store.get().accounts.find((a) => a.name === USER.name)!;
    const res = await asAdmin(`/api/dashboard/people/${target.id}/role`, {
      method: "PUT",
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(200);

    const log = await entries();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      action: "changed a role",
      target: target.id,
      outcome: "ok",
      notable: true,
    });
    expect(log[0].actor).toMatchObject({ kind: "person", name: ADMIN.name });
  });

  it("records nothing for a read", async () => {
    await asAdmin("/api/dashboard/settings");
    await asAdmin("/api/dashboard/people");
    expect(await entries()).toEqual([]);
  });

  it("names a machine by its token name, never as unknown", async () => {
    const minted = await asAdmin("/api/dashboard/devices", {
      method: "POST",
      body: JSON.stringify({ name: "companion machine" }),
    });
    expect(minted.status).toBe(201);

    const ran = await call("/api/action/preset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${minted.body.token}`,
      },
      body: JSON.stringify({ id: "preset-1" }),
    });
    expect(ran.status).toBe(200);

    const [entry] = await entries();
    expect(entry.action).toBe("ran a preset");
    expect(entry.actor).toEqual({ kind: "machine", id: minted.body.device.id, name: "companion machine" });
  });

  it("records the hosted connect, though it arrives as a GET", async () => {
    // The credentials change behind a browser navigation, so a method-only filter recorded
    // nothing and "who reconnected the channel" had no answer on a hosted deployment.
    expect(await navigate("/api/setup/oauth/callback?code=good-code&state=nonce", await cookieFor(ADMIN))).toBe(302);

    const [entry] = await entries();
    expect(entry).toMatchObject({ action: "connected YouTube", notable: true, method: "GET" });
    expect(entry.actor).toMatchObject({ kind: "person", name: ADMIN.name });
    // The authorization code is a credential in a query string, and the path is stored without it.
    expect(JSON.stringify(entry)).not.toContain("good-code");
  });

  it("does not call an abandoned attempt a reconnect", async () => {
    // Both outcomes leave as a 302 to the dashboard, so the status cannot tell them apart — the
    // handler says which it was.
    expect(await navigate("/api/setup/oauth/callback?code=planted&state=guessed", await cookieFor(ADMIN))).toBe(302);

    const [entry] = await entries();
    expect(entry.action).toBe("failed to connect YouTube");
    expect(entry.notable).toBe(false);
  });

  it("records a refusal, which is the entry an admin came looking for", async () => {
    const res = await call("/api/dashboard/people", {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie: await cookieFor(USER) },
    });
    expect(res.status).toBe(403);

    const [entry] = await entries();
    expect(entry.outcome).toBe("refused");
    expect(entry.actor.name).toBe(USER.name);
  });

  it("names the account somebody signed in as, on a route with no actor yet", async () => {
    // Sign-in is anonymous by definition — there is no session until it succeeds — so the name
    // attempted is the record. "anonymous signed in" would answer nothing.
    await audit.append({
      actor: { kind: "anonymous", id: null, name: "anonymous" },
      method: "POST",
      path: "/api/auth/login",
      status: 200,
      body: { name: "operator", password: "hunter2" },
      target: "operator",
    });
    const [entry] = await entries();
    expect(entry.action).toBe("signed in");
    expect(entry.target).toBe("operator");
    expect(JSON.stringify(entry)).not.toContain("hunter2");
  });
});

describe("what never gets recorded", () => {
  it("writes the payload without the secret in it", async () => {
    const res = await asAdmin("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        clientId: "1234.apps.googleusercontent.com",
        clientSecret: "GOCSPX-do-not-log-me",
        refreshToken: "1//0-do-not-log-me-either",
      }),
    });
    expect(res.status).toBe(200);

    const [entry] = await entries();
    // Asserted against the whole line, not one field: a secret that leaks into a nested copy is
    // just as copied-around as one in the obvious place.
    const line = JSON.stringify(entry);
    expect(line).not.toContain("GOCSPX-do-not-log-me");
    expect(line).not.toContain("1//0-do-not-log-me-either");
    // The half that explains the entry survives.
    expect(entry.detail).toMatchObject({ clientId: "1234.apps.googleusercontent.com" });

    // And the same holds of the file itself, which is the thing that gets copied around.
    await flush();
    const raw = await fs.readFile(path.join(dir, "audit.log"), "utf8");
    expect(raw).not.toContain("GOCSPX-do-not-log-me");
  });

  it("keeps the minted device token out of the log", async () => {
    const minted = await asAdmin("/api/dashboard/devices", {
      method: "POST",
      body: JSON.stringify({ name: "companion machine" }),
    });
    await flush();
    const raw = await fs.readFile(path.join(dir, "audit.log"), "utf8");
    expect(raw).not.toContain(minted.body.token);
    expect(raw).toContain("created a device token");
  });
});

describe("who may read it", () => {
  it("refuses a user", async () => {
    const res = await call("/api/dashboard/audit", {
      headers: { cookie: await cookieFor(USER) },
    });
    expect(res.status).toBe(403);
  });

  it("refuses a machine, which is never an admin", async () => {
    const minted = await asAdmin("/api/dashboard/devices", {
      method: "POST",
      body: JSON.stringify({ name: "companion machine" }),
    });
    const res = await call("/api/dashboard/audit", {
      headers: { authorization: `Bearer ${minted.body.token}` },
    });
    expect(res.status).toBe(403);
  });

  it("refuses a stranger", async () => {
    expect((await call("/api/dashboard/audit")).status).toBe(401);
  });

  it("narrows to the entries someone will come looking for", async () => {
    await asAdmin("/api/dashboard/devices", {
      method: "POST",
      body: JSON.stringify({ name: "companion machine" }),
    });
    await asAdmin("/api/dashboard/settings", { method: "PUT", body: JSON.stringify({ x: 1 }) });

    expect((await entries()).length).toBe(2);
    const notable = await entries("?notable=1");
    expect(notable).toHaveLength(1);
    expect(notable[0].action).toBe("created a device token");
  });

  it("finds a notable entry that routine traffic has pushed past the limit", async () => {
    await asAdmin("/api/dashboard/devices", {
      method: "POST",
      body: JSON.stringify({ name: "companion machine" }),
    });
    for (let i = 0; i < 5; i += 1) {
      await asAdmin("/api/dashboard/settings", { method: "PUT", body: JSON.stringify({ x: i }) });
    }

    // Narrowing has to happen before the cap. Filtering the newest three would report nothing,
    // while the entry an admin came for is still on disk.
    const notable = await entries("?notable=1&limit=3");
    expect(notable).toHaveLength(1);
    expect(notable[0].action).toBe("created a device token");
  });
});

describe("a caller who cases the path differently", () => {
  it("still records the action", async () => {
    const target = store.get().accounts.find((a) => a.name === USER.name)!;
    const res = await asAdmin(`/API/Dashboard/people/${target.id}/role`, {
      method: "PUT",
      body: JSON.stringify({ role: "admin" }),
    });
    // Express matched it and did the work; the log has to say so.
    expect(res.status).toBe(200);

    const log = await entries();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "changed a role", target: target.id, notable: true });
  });
});
