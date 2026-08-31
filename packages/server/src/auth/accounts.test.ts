import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../storage/jsonStore.js";
import { authenticate, createAccount, removeAccount, seedAdmin, setRole } from "./accounts.js";

let dir: string;
let store: JsonStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "accounts-"));
  store = new JsonStore(path.join(dir, "store.json"));
  await store.init();
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("seedAdmin", () => {
  it("creates the admin from configuration on first boot, with no interactive claim step", async () => {
    await seedAdmin(store, { name: "operator", password: "a-long-enough-secret" });
    const [admin] = store.get().accounts;
    expect(admin.name).toBe("operator");
    expect(admin.role).toBe("admin");
    expect(admin.seeded).toBe(true);
  });

  it("stores no plaintext password", async () => {
    await seedAdmin(store, { name: "operator", password: "a-long-enough-secret" });
    const persisted = await fs.readFile(path.join(dir, "store.json"), "utf8");
    expect(persisted).not.toContain("a-long-enough-secret");
  });

  it("is idempotent across boots and never rewrites a changed password", async () => {
    await seedAdmin(store, { name: "operator", password: "a-long-enough-secret" });
    const before = store.get().accounts[0].passwordHash;
    // The admin changed their password since; the boot-time seed must not put the old one back.
    await store.update((s) => {
      s.accounts[0].passwordHash = "scrypt$1$1$1$c2FsdA$a2V5";
    });
    await seedAdmin(store, { name: "OPERATOR", password: "a-long-enough-secret" });
    expect(store.get().accounts).toHaveLength(1);
    expect(store.get().accounts[0].passwordHash).not.toBe(before);
  });

  it("seeds nothing when no seed is configured, leaving the deployment open as it is today", async () => {
    expect(await seedAdmin(store, null)).toBeNull();
    expect(store.get().accounts).toEqual([]);
  });

  it("refuses to boot with a weak master credential", async () => {
    await expect(seedAdmin(store, { name: "operator", password: "short" })).rejects.toThrow(
      /at least/,
    );
  });
});

describe("authenticate", () => {
  it("accepts the seeded credential", async () => {
    await seedAdmin(store, { name: "operator", password: "a-long-enough-secret" });
    const account = await authenticate(store, "operator", "a-long-enough-secret");
    expect(account?.role).toBe("admin");
  });

  it("matches the sign-in name case-insensitively", async () => {
    await seedAdmin(store, { name: "Operator", password: "a-long-enough-secret" });
    expect(await authenticate(store, "OPERATOR", "a-long-enough-secret")).not.toBeNull();
  });

  it("rejects a wrong password", async () => {
    await seedAdmin(store, { name: "operator", password: "a-long-enough-secret" });
    expect(await authenticate(store, "operator", "wrong-password")).toBeNull();
  });

  it("answers identically for an unknown account, revealing nothing about who exists", async () => {
    await seedAdmin(store, { name: "operator", password: "a-long-enough-secret" });
    expect(await authenticate(store, "nobody", "a-long-enough-secret")).toBeNull();
  });

  it("spends comparable time on a missing account as on a real one", async () => {
    await seedAdmin(store, { name: "operator", password: "a-long-enough-secret" });
    const time = async (name: string) => {
      const started = performance.now();
      await authenticate(store, name, "some-password");
      return performance.now() - started;
    };
    // Warm both paths first: the decoy hash is derived once, lazily.
    await time("nobody");
    const real = await time("operator");
    const missing = await time("nobody");
    // Not a strict constant-time claim — just that a missing account is not an order of
    // magnitude faster, which is what would enumerate accounts.
    expect(missing).toBeGreaterThan(real / 4);
  });
});

describe("createAccount", () => {
  it("adds a person with the role they were given, and stores no plaintext password", async () => {
    const account = await createAccount(store, {
      name: "camera",
      password: "another-long-secret",
      role: "user",
    });
    expect(account.role).toBe("user");
    expect(account.seeded).toBe(false);
    expect(store.get().accounts.map((a) => a.name)).toEqual(["camera"]);
    const persisted = await fs.readFile(path.join(dir, "store.json"), "utf8");
    expect(persisted).not.toContain("another-long-secret");
    expect(await authenticate(store, "camera", "another-long-secret")).toMatchObject({
      id: account.id,
    });
  });

  it("refuses a name another account already answers to, whatever its casing", async () => {
    await createAccount(store, { name: "camera", password: "another-long-secret", role: "user" });
    await expect(
      createAccount(store, { name: "Camera", password: "yet-another-secret", role: "user" }),
    ).rejects.toThrow(/already/i);
  });

  it("refuses a password shorter than the seed's own minimum", async () => {
    await expect(
      createAccount(store, { name: "camera", password: "short", role: "user" }),
    ).rejects.toThrow(/12 characters/i);
    expect(store.get().accounts).toHaveLength(0);
  });

  it("lands only one of two concurrent creates of the same name", async () => {
    // Both start before either has hashed, so neither can see the other in the pre-check — only
    // the serialized update can. Without the check inside it, authenticate would then be a coin
    // toss between two accounts called `camera`.
    const results = await Promise.allSettled([
      createAccount(store, { name: "camera", password: "another-long-secret", role: "user" }),
      createAccount(store, { name: "Camera", password: "yet-another-secret", role: "user" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(store.get().accounts).toHaveLength(1);
  });
});

describe("the last admin", () => {
  it("cannot be demoted — at 11pm there is no way back", async () => {
    const admin = (await seedAdmin(store, { name: "operator", password: "a-long-enough-secret" }))!;
    await createAccount(store, { name: "camera", password: "another-long-secret", role: "user" });
    await expect(setRole(store, admin.id, "user")).rejects.toThrow(/last admin/i);
    expect(store.get().accounts.find((a) => a.id === admin.id)!.role).toBe("admin");
  });

  it("cannot be removed either", async () => {
    const admin = (await seedAdmin(store, { name: "operator", password: "a-long-enough-secret" }))!;
    await expect(removeAccount(store, admin.id)).rejects.toThrow(/last admin/i);
    expect(store.get().accounts).toHaveLength(1);
  });

  it("survives two admins being demoted at the same moment", async () => {
    // The check has to happen inside the store's serialized update: run outside it, both calls
    // see two admins, both proceed, and the deployment is left with none — the one state no
    // amount of dashboard use can recover from.
    const first = (await seedAdmin(store, { name: "operator", password: "a-long-enough-secret" }))!;
    const second = await createAccount(store, {
      name: "producer",
      password: "another-long-secret",
      role: "admin",
    });
    await Promise.allSettled([setRole(store, first.id, "user"), setRole(store, second.id, "user")]);
    expect(store.get().accounts.filter((a) => a.role === "admin")).toHaveLength(1);
  });

  it("survives the last two admins being removed at the same moment", async () => {
    const first = (await seedAdmin(store, { name: "operator", password: "a-long-enough-secret" }))!;
    const second = await createAccount(store, {
      name: "producer",
      password: "another-long-secret",
      role: "admin",
    });
    await Promise.allSettled([
      removeAccount(store, first.id),
      removeAccount(store, second.id),
    ]);
    expect(store.get().accounts.filter((a) => a.role === "admin")).toHaveLength(1);
  });

  it("stops being the last one as soon as a second admin exists", async () => {
    const admin = (await seedAdmin(store, { name: "operator", password: "a-long-enough-secret" }))!;
    const second = await createAccount(store, {
      name: "producer",
      password: "another-long-secret",
      role: "admin",
    });
    await setRole(store, admin.id, "user");
    expect(store.get().accounts.find((a) => a.id === admin.id)!.role).toBe("user");
    // …and now the second one is the last, so it is the one that cannot go.
    await expect(setRole(store, second.id, "user")).rejects.toThrow(/last admin/i);
  });
});

describe("setRole", () => {
  it("promotes a user to admin", async () => {
    await seedAdmin(store, { name: "operator", password: "a-long-enough-secret" });
    const user = await createAccount(store, {
      name: "camera",
      password: "another-long-secret",
      role: "user",
    });
    expect((await setRole(store, user.id, "admin")).role).toBe("admin");
    expect(store.get().accounts.find((a) => a.id === user.id)!.role).toBe("admin");
  });

  it("refuses an account that does not exist", async () => {
    await seedAdmin(store, { name: "operator", password: "a-long-enough-secret" });
    await expect(setRole(store, "nobody", "admin")).rejects.toThrow(/not found|no such/i);
  });
});
