import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../storage/jsonStore.js";
import { Auth, SESSION_COOKIE } from "../auth/actor.js";
import { createAccount } from "../auth/accounts.js";
import { devicesRouter } from "./devices.js";
import { GRACE_DAYS_REQUIRED } from "../auth/grace.js";

/**
 * Device tokens and grace mode at the HTTP surface (issue 047).
 *
 * Mounted the way app.ts mounts them, because half the behaviour under test *is* the mounting: a
 * machine token reaching an admin route is the failure this slice exists to make impossible, and
 * "the guard is on the mount" is the only reason it cannot.
 */

const ADMIN = { name: "operator", password: "a-long-enough-secret" };
const USER = { name: "camera", password: "another-long-secret", role: "user" as const };

let dir: string;
let store: JsonStore;
let auth: Auth;
let server: http.Server;
let base: string;
let now: number;

async function call(url: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${url}`, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function cookieFor(name: string, password: string): Promise<string> {
  const signIn = await auth.signIn(name, password, "1.2.3.4");
  if (!signIn.ok) throw new Error(`could not sign ${name} in`);
  return `${SESSION_COOKIE}=${signIn.token}`;
}

/** Mints a token as the admin would, through the route rather than around it. */
async function mint(name = "companion machine"): Promise<string> {
  const res = await call("/devices", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: await cookieFor(ADMIN.name, ADMIN.password),
    },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return res.body.token as string;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "devices-"));
  store = new JsonStore(path.join(dir, "store.json"));
  await store.init();
  now = Date.UTC(2026, 0, 1);
  auth = new Auth(store, () => now);
  await auth.seed(ADMIN);
  await createAccount(store, USER);

  const app = express();
  app.use(express.json());
  // Mounted exactly as app.ts does: session guard, then admin guard, then the router.
  app.use("/devices", auth.requireSession(), auth.requireAdmin(), devicesRouter({ store, auth }));
  // A stand-in for the show-running routes under /api/dashboard — session guard only.
  app.get("/dashboard/state", auth.requireSession(), (_req, res) => res.json({ ok: true }));
  // A stand-in for a Companion-facing endpoint.
  app.get("/action/refresh", auth.requireCompanion(), (_req, res) => res.json({ ok: true }));

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

describe("who may mint a device token", () => {
  it("lets an admin create and name one", async () => {
    const res = await call("/devices", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await cookieFor(ADMIN.name, ADMIN.password),
      },
      body: JSON.stringify({ name: "companion machine" }),
    });
    expect(res.status).toBe(201);
    expect(res.body.device.name).toBe("companion machine");
    expect(res.body.device.createdBy).toBe("operator");
    expect(res.body.token).toMatch(/^ytm_/);
  });

  it("refuses a user, who runs the show but does not hand out credentials", async () => {
    const res = await call("/devices", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await cookieFor(USER.name, USER.password),
      },
      body: JSON.stringify({ name: "sneaky" }),
    });
    expect(res.status).toBe(403);
  });

  it("refuses a nameless token, because a list of unnamed tokens is unrevocable", async () => {
    const res = await call("/devices", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await cookieFor(ADMIN.name, ADMIN.password),
      },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("shows the token once and never again", async () => {
    const token = await mint();
    const list = await call("/devices", {
      headers: { cookie: await cookieFor(ADMIN.name, ADMIN.password) },
    });
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(list.body.tokens[0]).not.toHaveProperty("tokenHash");
  });
});

describe("what a device token can and cannot reach", () => {
  it("authenticates an HTTP request the module makes", async () => {
    const token = await mint();
    const res = await call("/dashboard/state", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
  });

  it("is refused on an admin route, under any construction", async () => {
    const token = await mint();
    // The header the module sends, and every near-miss spelling of it. A token that reached here
    // would be a credential in a config file on a shared desk that owns the channel.
    for (const authorization of [
      `Bearer ${token}`,
      `bearer ${token}`,
      `BEARER    ${token}`,
      token,
    ]) {
      const res = await call("/devices", { headers: { authorization } });
      expect([401, 403], authorization).toContain(res.status);
    }
    // And not as a session cookie either: a device token is not a session, whatever it is put in.
    const asCookie = await call("/devices", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(asCookie.status).toBe(401);
  });

  it("cannot mint another token, which is the whole reason it is not an admin", async () => {
    const token = await mint();
    const res = await call("/devices", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "escalated" }),
    });
    expect(res.status).toBe(403);
  });

  it("stops working the moment it is revoked", async () => {
    const token = await mint();
    const cookie = await cookieFor(ADMIN.name, ADMIN.password);
    const created = await call("/devices", { headers: { cookie } });
    const id = created.body.tokens[0].id;

    expect((await call("/dashboard/state", { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await call(`/devices/${id}`, { method: "DELETE", headers: { cookie } })).status).toBe(200);
    expect((await call("/dashboard/state", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it("leaves the other machines alone when one is revoked", async () => {
    const a = await mint("companion machine");
    const b = await mint("booth laptop");
    const cookie = await cookieFor(ADMIN.name, ADMIN.password);
    const list = await call("/devices", { headers: { cookie } });
    const idA = list.body.tokens.find((t: any) => t.name === "companion machine").id;

    await call(`/devices/${idA}`, { method: "DELETE", headers: { cookie } });

    expect((await call("/dashboard/state", { headers: { authorization: `Bearer ${a}` } })).status).toBe(401);
    expect((await call("/dashboard/state", { headers: { authorization: `Bearer ${b}` } })).status).toBe(200);
  });
});

describe("grace mode", () => {
  const graceOf = async () =>
    (await call("/devices/grace", { headers: { cookie: await cookieFor(ADMIN.name, ADMIN.password) } }))
      .body;

  it("accepts a tokenless Companion connection — and records it", async () => {
    const res = await call("/action/refresh", { headers: { "user-agent": "Companion/3.4.0" } });
    expect(res.status).toBe(200);

    const g = await graceOf();
    expect(g.tokenlessCount).toBe(1);
    expect(g.lastTokenlessClient).toBe("Companion/3.4.0");
    expect(g.lastTokenlessRoute).toBe("/action/refresh");
    expect(g.enforcing).toBe(false);
  });

  it("does not record a connection that carried a token", async () => {
    const token = await mint();
    await call("/action/refresh", { headers: { authorization: `Bearer ${token}` } });
    expect((await graceOf()).tokenlessCount).toBe(0);
  });

  it("reports the exit condition as two counters, and requires both", async () => {
    await call("/action/refresh", { headers: { "user-agent": "Companion/3.4.0" } });
    now += GRACE_DAYS_REQUIRED * 24 * 60 * 60 * 1000;

    // Fourteen quiet days with no show in them: the off-season case. Not met.
    let g = await graceOf();
    expect(g.daysSinceTokenless).toBe(GRACE_DAYS_REQUIRED);
    expect(g.goLivesSinceTokenless).toBe(0);
    expect(g.met).toBe(false);

    await auth.grace.recordGoLive("show-1");
    g = await graceOf();
    expect(g.met).toBe(true);

    // And one tokenless connection puts both halves back to zero.
    await call("/action/refresh", { headers: { "user-agent": "Companion/3.4.0" } });
    g = await graceOf();
    expect(g.daysSinceTokenless).toBe(0);
    expect(g.goLivesSinceTokenless).toBe(0);
    expect(g.met).toBe(false);
  });

  it("refuses a tokenless caller once enforcement is on, and still admits a token", async () => {
    const token = await mint();
    await auth.grace.setEnforcing(true);

    expect((await call("/action/refresh")).status).toBe(401);
    expect((await call("/action/refresh", { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);

    // Rollback, without a rebuild or a redeploy (issue 049 puts a control on this).
    await auth.grace.setEnforcing(false);
    expect((await call("/action/refresh")).status).toBe(200);
  });
});
