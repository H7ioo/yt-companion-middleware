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
import { authRouter } from "./auth.js";

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
  app.use("/people", auth.requireSession(), auth.requireAdmin(), peopleRouter({ store, auth }));
  app.use("/auth", authRouter(auth));
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

/**
 * Issue 046. The three things this slice has to get right, and each has a way of quietly not
 * being true: an invite that can be spent twice, a revocation that takes out the wrong device,
 * and a removal that only bites whenever the session happens to lapse.
 */

const idOfName = (name: string) => store.get().accounts.find((a) => a.name === name)!.id;

/** Creates an invite as the named person, returning the whole response. */
async function makeInvite(who: { name: string; password: string }, role = "user") {
  return call("/people/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: await cookieFor(who.name, who.password) },
    body: JSON.stringify({ role }),
  });
}

/** Follows an invite link the way the redemption page does. */
function redeem(token: string, name: string, password: string) {
  return call(`/auth/invite?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
}

describe("inviting someone in", () => {
  it("gives an admin a link, and a user nothing", async () => {
    const admin = await makeInvite(ADMIN);
    expect(admin.status).toBe(201);
    expect(admin.body.token).toBeTruthy();
    expect(admin.body.path).toContain("/invite?token=");

    expect((await makeInvite(USER)).status).toBe(403);
  });

  it("never hands the token back a second time", async () => {
    const { body } = await makeInvite(ADMIN);
    const list = await call("/people/invites", {
      headers: { cookie: await cookieFor(ADMIN.name, ADMIN.password) },
    });
    expect(list.body.invites).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(body.token);
    expect(JSON.stringify(list.body)).not.toContain("tokenHash");
  });

  it("lets the invitee set their own credential and signs them straight in", async () => {
    const { body } = await makeInvite(ADMIN);
    const res = await redeem(body.token, "sound", "a-long-enough-secret");
    expect(res.status).toBe(201);
    expect(res.body.account).toMatchObject({ name: "sound", role: "user" });

    // And the credential they chose actually works.
    const signIn = await auth.signIn("sound", "a-long-enough-secret", "1.2.3.4");
    expect(signIn.ok).toBe(true);
  });

  it("takes the role from the invite, not from the request", async () => {
    const { body } = await makeInvite(ADMIN, "user");
    const res = await call(`/auth/invite?token=${encodeURIComponent(body.token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "sound", password: "a-long-enough-secret", role: "admin" }),
    });
    expect(res.status).toBe(201);
    expect(store.get().accounts.find((a) => a.name === "sound")!.role).toBe("user");
  });

  it("is single-use, and says so rather than throwing", async () => {
    const { body } = await makeInvite(ADMIN);
    expect((await redeem(body.token, "sound", "a-long-enough-secret")).status).toBe(201);

    const again = await redeem(body.token, "lights", "a-long-enough-secret");
    expect(again.status).toBe(410);
    expect(again.body.error.code).toBe("INVITE_INVALID");
    expect(again.body.error.message).toMatch(/already been used/i);
    expect(store.get().accounts.some((a) => a.name === "lights")).toBe(false);
  });

  it("stops working once it has expired", async () => {
    const { token } = (await auth.invites.create({ role: "user", createdBy: idOfName("operator"), ttlMs: 1 })
    );
    await new Promise((r) => setTimeout(r, 5));
    const res = await redeem(token, "sound", "a-long-enough-secret");
    expect(res.status).toBe(410);
    expect(res.body.error.message).toMatch(/expired/i);
  });

  it("refuses a link that was never real", async () => {
    const res = await redeem("not-a-real-token", "sound", "a-long-enough-secret");
    expect(res.status).toBe(410);
    expect(res.body.error.message).toMatch(/not valid/i);
  });

  it("says the link is dead on arrival, before anyone types a password", async () => {
    const { body } = await makeInvite(ADMIN);
    expect((await call(`/auth/invite?token=${encodeURIComponent(body.token)}`)).status).toBe(200);
    await redeem(body.token, "sound", "a-long-enough-secret");
    const after = await call(`/auth/invite?token=${encodeURIComponent(body.token)}`);
    expect(after.status).toBe(410);
  });

  it("refuses a password that is too short, and leaves the invite usable", async () => {
    const { body } = await makeInvite(ADMIN);
    const short = await redeem(body.token, "sound", "short");
    expect(short.status).toBe(400);
    // The important half: a fat-fingered password must not burn the only link they were sent.
    expect((await redeem(body.token, "sound", "a-long-enough-secret")).status).toBe(201);
  });

  it("refuses a name somebody already has", async () => {
    const { body } = await makeInvite(ADMIN);
    const res = await redeem(body.token, "Camera", "a-long-enough-secret");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/already called/i);
  });

  it("lets an admin withdraw an invite before it is used", async () => {
    const { body } = await makeInvite(ADMIN);
    const cancel = await call(`/people/invites/${body.invite.id}`, {
      method: "DELETE",
      headers: { cookie: await cookieFor(ADMIN.name, ADMIN.password) },
    });
    expect(cancel.status).toBe(200);
    expect((await redeem(body.token, "sound", "a-long-enough-secret")).status).toBe(410);
  });
});

describe("cutting one device off", () => {
  it("leaves the account's other sessions working", async () => {
    const phone = await cookieFor(USER.name, USER.password);
    const laptop = await cookieFor(USER.name, USER.password);
    const id = idOfName("camera");

    const devices = await call(`/people/${id}/sessions`, {
      headers: { cookie: await cookieFor(ADMIN.name, ADMIN.password) },
    });
    expect(devices.status).toBe(200);
    expect(devices.body.sessions).toHaveLength(2);
    expect(JSON.stringify(devices.body)).not.toContain("tokenHash");

    // Revoke whichever session the phone cookie resolves to, and only that one.
    const phoneSession = (await auth.actorOfCookies(phone))!.session.id;
    const revoke = await call(`/people/${id}/sessions/${phoneSession}`, {
      method: "DELETE",
      headers: { cookie: await cookieFor(ADMIN.name, ADMIN.password) },
    });
    expect(revoke.status).toBe(200);

    expect(await auth.actorOfCookies(phone)).toBeNull();
    expect(await auth.actorOfCookies(laptop)).not.toBeNull();
  });

  it("will not revoke a session belonging to someone else", async () => {
    const adminCookie = await cookieFor(ADMIN.name, ADMIN.password);
    const adminSession = (await auth.actorOfCookies(adminCookie))!.session.id;
    // The admin's own session id, aimed at the user's account: the ids must not be interchangeable.
    const res = await call(`/people/${idOfName("camera")}/sessions/${adminSession}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(400);
    expect(await auth.actorOfCookies(adminCookie)).not.toBeNull();
  });
});

describe("removing an account", () => {
  it("cuts every one of its sessions off on the next request", async () => {
    const phone = await cookieFor(USER.name, USER.password);
    const laptop = await cookieFor(USER.name, USER.password);

    const res = await call(`/people/${idOfName("camera")}`, {
      method: "DELETE",
      headers: { cookie: await cookieFor(ADMIN.name, ADMIN.password) },
    });
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({ name: "camera" });

    expect(await auth.actorOfCookies(phone)).toBeNull();
    expect(await auth.actorOfCookies(laptop)).toBeNull();
    expect(store.get().sessions.filter((s) => s.accountId === res.body.account.id)).toEqual([]);
    expect(store.get().accounts.some((a) => a.name === "camera")).toBe(false);
  });

  it("refuses a user removing anyone", async () => {
    const res = await call(`/people/${idOfName("camera")}`, {
      method: "DELETE",
      headers: { cookie: await cookieFor(USER.name, USER.password) },
    });
    expect(res.status).toBe(403);
    expect(store.get().accounts.some((a) => a.name === "camera")).toBe(true);
  });

  it("refuses to remove the seeded admin, and says why", async () => {
    const res = await call(`/people/${idOfName("operator")}`, {
      method: "DELETE",
      headers: { cookie: await cookieFor(ADMIN.name, ADMIN.password) },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/set up at install/i);
    expect(store.get().accounts.some((a) => a.name === "operator")).toBe(true);
  });

  it("refuses to remove the last admin", async () => {
    // Promote camera, remove the seeded admin's admin-ness, then try to remove camera: it is now
    // the only admin left, and the last-admin rule is what has to catch it.
    const cookie = await cookieFor(ADMIN.name, ADMIN.password);
    await call(`/people/${idOfName("camera")}/role`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ role: "admin" }),
    });
    await call(`/people/${idOfName("operator")}/role`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ role: "user" }),
    });
    // Asked by camera itself, which is now the only admin: the demoted operator would be turned
    // away by the admin guard first, and this rule would never get its say.
    const res = await call(`/people/${idOfName("camera")}`, {
      method: "DELETE",
      headers: { cookie: await cookieFor(USER.name, USER.password) },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/last admin/i);
    expect(store.get().accounts.some((a) => a.name === "camera")).toBe(true);
  });
});
