import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../storage/jsonStore.js";
import { Auth, SESSION_COOKIE } from "../auth/actor.js";
import { createAccount } from "../auth/accounts.js";
import { peopleRouter } from "./people.js";

/**
 * The people routes (issue 045): who is here, and who may change that. Mounted the way app.ts
 * mounts them — session guard, then admin guard — because "a user gets a 403 here" is the whole
 * behaviour, and it lives in the mounting as much as in the router.
 */

const ADMIN = { name: "operator", password: "a-long-enough-secret" };
const USER = { name: "camera", password: "another-long-secret", role: "user" as const };

let dir: string;
let store: JsonStore;
let auth: Auth;
let server: http.Server;
let base: string;

async function call(url: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${url}`, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Signs someone in and returns their Cookie header. */
async function cookieFor(name: string, password: string): Promise<string> {
  const signIn = await auth.signIn(name, password, "1.2.3.4");
  if (!signIn.ok) throw new Error(`could not sign ${name} in`);
  return `${SESSION_COOKIE}=${signIn.token}`;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "people-"));
  store = new JsonStore(path.join(dir, "store.json"));
  await store.init();
  auth = new Auth(store);
  await auth.seed(ADMIN);
  await createAccount(store, USER);

  const app = express();
  app.use(express.json());
  app.use("/people", auth.requireSession(), auth.requireAdmin(), peopleRouter({ store }));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

describe("who may look", () => {
  it("lists everyone for an admin, without a password hash in sight", async () => {
    const res = await call("/people", { headers: { cookie: await cookieFor(ADMIN.name, ADMIN.password) } });
    expect(res.status).toBe(200);
    expect(res.body.accounts.map((a: any) => [a.name, a.role])).toEqual([
      ["operator", "admin"],
      ["camera", "user"],
    ]);
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("refuses a user", async () => {
    const res = await call("/people", { headers: { cookie: await cookieFor(USER.name, USER.password) } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

describe("changing a role", () => {
  /** PUTs a role change as the named signed-in person. */
  async function setRole(who: { name: string; password: string }, id: string, role: string) {
    return call(`/people/${id}/role`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: await cookieFor(who.name, who.password) },
      body: JSON.stringify({ role }),
    });
  }

  const idOf = (name: string) => store.get().accounts.find((a) => a.name === name)!.id;

  it("promotes a user when an admin asks", async () => {
    const res = await setRole(ADMIN, idOf("camera"), "admin");
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({ name: "camera", role: "admin" });
    expect(store.get().accounts.find((a) => a.name === "camera")!.role).toBe("admin");
  });

  it("refuses a user promoting themselves", async () => {
    const res = await setRole(USER, idOf("camera"), "admin");
    expect(res.status).toBe(403);
    expect(store.get().accounts.find((a) => a.name === "camera")!.role).toBe("user");
  });

  it("refuses to demote the last admin, and says why", async () => {
    const res = await setRole(ADMIN, idOf("operator"), "user");
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/last admin/i);
    expect(store.get().accounts.find((a) => a.name === "operator")!.role).toBe("admin");
  });

  it("lets the last admin step down once someone else can take over", async () => {
    await setRole(ADMIN, idOf("camera"), "admin");
    expect((await setRole(ADMIN, idOf("operator"), "user")).status).toBe(200);
  });

  it("rejects a role that is not one of the two", async () => {
    const res = await setRole(ADMIN, idOf("camera"), "superuser");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REQUEST");
  });

  it("rejects an account that does not exist", async () => {
    const res = await setRole(ADMIN, "nobody", "admin");
    expect(res.status).toBe(400);
  });
});
