import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../storage/jsonStore.js";
import { Sessions } from "./sessions.js";

const DAY = 24 * 60 * 60 * 1000;

let dir: string;
let store: JsonStore;
let now: number;

/** A store holding one account, so sessions have something to belong to. */
async function seedAccount(): Promise<string> {
  await store.update((s) => {
    s.accounts = [
      {
        id: "acc1",
        name: "operator",
        passwordHash: "scrypt$1$1$1$c2FsdA$a2V5",
        role: "admin",
        createdAt: new Date(now).toISOString(),
        seeded: true,
      },
    ];
  });
  return "acc1";
}

/**
 * Advances the clock by `days`, touching the session on the way so the idle clock never lapses —
 * the state of a browser that is simply in daily use.
 */
async function stayActiveFor(sessions: Sessions, token: string, days: number): Promise<void> {
  for (let remaining = days; remaining > 0; remaining -= 20) {
    now += Math.min(20, remaining) * DAY;
    await sessions.resolve(token);
  }
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "sessions-"));
  store = new JsonStore(path.join(dir, "store.json"));
  await store.init();
  now = Date.UTC(2026, 0, 1);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("Sessions", () => {
  it("resolves a freshly issued token to its account", async () => {
    const accountId = await seedAccount();
    const sessions = new Sessions(store, () => now);
    const { token } = await sessions.create(accountId);
    const actor = await sessions.resolve(token);
    expect(actor?.account.id).toBe(accountId);
  });

  it("does not store the cookie token itself", async () => {
    const accountId = await seedAccount();
    const sessions = new Sessions(store, () => now);
    const { token } = await sessions.create(accountId);
    const persisted = await fs.readFile(path.join(dir, "store.json"), "utf8");
    expect(persisted).not.toContain(token);
  });

  it("refuses an unknown token", async () => {
    await seedAccount();
    const sessions = new Sessions(store, () => now);
    expect(await sessions.resolve("not-a-real-token")).toBeNull();
    expect(await sessions.resolve(undefined)).toBeNull();
  });

  it("refuses a signed-out session", async () => {
    const accountId = await seedAccount();
    const sessions = new Sessions(store, () => now);
    const { token } = await sessions.create(accountId);
    await sessions.revoke(token);
    expect(await sessions.resolve(token)).toBeNull();
  });

  it("refuses a session idle past 30 days", async () => {
    const accountId = await seedAccount();
    const sessions = new Sessions(store, () => now);
    const { token } = await sessions.create(accountId);
    now += 31 * DAY;
    expect(await sessions.resolve(token)).toBeNull();
  });

  it("keeps refreshing an idle clock that is used inside 30 days", async () => {
    const accountId = await seedAccount();
    const sessions = new Sessions(store, () => now);
    const { token } = await sessions.create(accountId);
    // Used every 20 days for two months: never idle for 30, so it stays alive.
    for (let i = 0; i < 3; i++) {
      now += 20 * DAY;
      expect(await sessions.resolve(token)).not.toBeNull();
    }
  });

  it("refuses a session 90 days past creation however active it has been", async () => {
    const accountId = await seedAccount();
    const sessions = new Sessions(store, () => now);
    const { token } = await sessions.create(accountId);
    // Touched daily — the idle clock never lapses, and the cap still lands.
    for (let i = 0; i < 89; i++) {
      now += DAY;
      expect(await sessions.resolve(token)).not.toBeNull();
    }
    now += 2 * DAY;
    expect(await sessions.resolve(token)).toBeNull();
  });

  it("reports itself as expiring inside the last 7 days before the cap", async () => {
    const accountId = await seedAccount();
    const sessions = new Sessions(store, () => now);
    const { token } = await sessions.create(accountId);
    await stayActiveFor(sessions, token, 82);
    expect((await sessions.resolve(token))?.expiringSoon).toBe(false);
    now += 2 * DAY;
    expect((await sessions.resolve(token))?.expiringSoon).toBe(true);
  });

  it("issues a fresh absolute clock on re-authentication, and retires the old session", async () => {
    const accountId = await seedAccount();
    const sessions = new Sessions(store, () => now);
    const { token } = await sessions.create(accountId);
    await stayActiveFor(sessions, token, 85);
    const renewed = await sessions.reauthenticate(token);
    expect(renewed).not.toBeNull();
    // The old cookie is dead the moment the new one is issued.
    expect(await sessions.resolve(token)).toBeNull();
    // And the new one is good for another 90 days, not the 5 the old one had left.
    await stayActiveFor(sessions, renewed!.token, 60);
    const actor = await sessions.resolve(renewed!.token);
    expect(actor).not.toBeNull();
    expect(actor?.expiringSoon).toBe(false);
  });

  it("cannot re-authenticate a session that is already dead", async () => {
    const accountId = await seedAccount();
    const sessions = new Sessions(store, () => now);
    const { token } = await sessions.create(accountId);
    now += 91 * DAY;
    expect(await sessions.reauthenticate(token)).toBeNull();
  });

  it("refuses a session whose account has been removed", async () => {
    const accountId = await seedAccount();
    const sessions = new Sessions(store, () => now);
    const { token } = await sessions.create(accountId);
    await store.update((s) => {
      s.accounts = [];
    });
    expect(await sessions.resolve(token)).toBeNull();
  });

  it("survives a restart, because sessions are persisted rather than held in memory", async () => {
    const accountId = await seedAccount();
    const { token } = await new Sessions(store, () => now).create(accountId);
    const reopened = new JsonStore(path.join(dir, "store.json"));
    await reopened.init();
    expect(await new Sessions(reopened, () => now).resolve(token)).not.toBeNull();
  });

  it("sweeps expired sessions out of the store when a new one is issued", async () => {
    const accountId = await seedAccount();
    const sessions = new Sessions(store, () => now);
    await sessions.create(accountId);
    now += 31 * DAY;
    await sessions.create(accountId);
    expect(store.get().sessions).toHaveLength(1);
  });
});
