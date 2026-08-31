import { nanoid } from "nanoid";
import type { JsonStore } from "../storage/jsonStore.js";
import type { Account } from "../storage/schema.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { AppError } from "../core/errors.js";

/**
 * Accounts for the hosted deployment (PRD-15 §2, issue 043).
 *
 * The first admin is seeded from configuration at boot and never claimed through an open setup
 * page: a fresh public host with an unclaimed setup screen belongs to whoever finds it first.
 */

export interface SeedConfig {
  name: string;
  password: string;
}

/**
 * The shortest password this deployment accepts, for the seeded admin and for everyone added
 * afterwards. A seeded admin is the deployment's master key; the accounts created beside it reach
 * the same dashboard, so they are held to the same length.
 */
export const MIN_PASSWORD_LENGTH = 12;

/** Sign-in names are compared case-insensitively, so `Operator` and `operator` are one account. */
function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Ensures the configured admin exists. Idempotent: on every boot after the first it finds the
 * account already there and leaves it alone — in particular it never rewrites the stored password,
 * so an admin who has changed their own credential does not silently get the boot-time one back.
 *
 * Returns the seeded account, or null when no seed is configured — which is the desktop/LAN case,
 * where the deployment has no accounts at all and authentication stays dormant.
 */
export async function seedAdmin(store: JsonStore, seed: SeedConfig | null): Promise<Account | null> {
  if (!seed?.name || !seed.password) return null;
  if (seed.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `seeded admin password must be at least ${MIN_PASSWORD_LENGTH} characters — refusing to boot with a weak master credential`,
    );
  }
  const existing = store.get().accounts.find((a) => sameName(a.name, seed.name));
  if (existing) return existing;

  const account: Account = {
    id: nanoid(),
    name: seed.name,
    passwordHash: await hashPassword(seed.password),
    role: "admin",
    createdAt: new Date().toISOString(),
    seeded: true,
  };
  await store.update((s) => {
    s.accounts = [...s.accounts, account];
  });
  return account;
}

/**
 * Adds a person. The role is the caller's to decide — the route above it is what limits who may
 * ask for an admin (issue 045); this is the store-level operation, used by the role-management
 * routes now and by invite redemption in issue 046.
 *
 * Names are unique case-insensitively, because sign-in compares them that way: two accounts
 * called `Camera` and `camera` would make "which one did I just authenticate?" a coin toss.
 */
export async function createAccount(
  store: JsonStore,
  person: { name: string; password: string; role: Account["role"] },
): Promise<Account> {
  const name = person.name.trim();
  if (person.password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(
      "INVALID_REQUEST",
      `A password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  // Cheap rejection of the obvious duplicate, so the common mistake does not pay for a scrypt
  // hash. The check that actually decides is the one inside the update below.
  if (store.get().accounts.some((a) => sameName(a.name, name))) {
    throw new AppError("INVALID_REQUEST", `Someone here is already called "${name}".`);
  }
  const account: Account = {
    id: nanoid(),
    name,
    passwordHash: await hashPassword(person.password),
    role: person.role,
    createdAt: new Date().toISOString(),
    seeded: false,
  };
  await store.update((s) => {
    // Re-checked here, not only above: hashing takes ~100ms, and two creates of the same name
    // that start within that window would both pass an earlier check and both land. Only the
    // store's own serialized update can see the other one.
    if (s.accounts.some((a) => sameName(a.name, name))) {
      throw new AppError("INVALID_REQUEST", `Someone here is already called "${name}".`);
    }
    s.accounts = [...s.accounts, account];
  });
  return account;
}

/**
 * Changes someone's role (issue 045). Refuses to demote the last admin — see
 * {@link assertAnAdminRemains}.
 */
export async function setRole(
  store: JsonStore,
  accountId: string,
  role: Account["role"],
): Promise<Account> {
  let updated!: Account;
  // Lookup, invariant and write all happen inside the one serialized update: checking outside it
  // lets two concurrent demotions of two different admins both see two admins and both proceed.
  await store.update((s) => {
    const record = mustFind(s.accounts, accountId);
    if (role !== "admin") assertAnAdminRemains(s.accounts, record);
    record.role = role;
    updated = { ...record };
  });
  return updated;
}

/**
 * Removes an account, and its sessions with it. The cut-off is immediate either way — session
 * resolution refuses a session whose account is gone — but the records go too, so a removed
 * person leaves nothing behind in the store. Issue 046 adds the route and the invite half.
 */
export async function removeAccount(store: JsonStore, accountId: string): Promise<Account> {
  let removed!: Account;
  // Inside the update for the same reason as {@link setRole}: the invariant is only sound when
  // nothing else can be removing an admin between the check and the write.
  await store.update((s) => {
    const record = mustFind(s.accounts, accountId);
    assertAnAdminRemains(s.accounts, record);
    removed = { ...record };
    s.accounts = s.accounts.filter((a) => a.id !== accountId);
    s.sessions = s.sessions.filter((x) => x.accountId !== accountId);
  });
  return removed;
}

/**
 * The one invariant this deployment cannot recover from breaking: **an admin must remain**.
 * Demoting or removing the last one leaves a workspace nobody can add people to, change roles in,
 * or reconnect YouTube from — and the only fix is shell access to the host, at whatever hour it
 * is discovered. Cheap to refuse, unrecoverable to allow.
 */
function assertAnAdminRemains(accounts: Account[], leaving: Account): void {
  if (leaving.role !== "admin") return;
  const admins = accounts.filter((a) => a.role === "admin");
  if (admins.length > 1) return;
  throw new AppError(
    "FORBIDDEN",
    `${leaving.name} is the last admin. Make someone else an admin first.`,
  );
}

/** The live record for an id, as it stands inside an update. Throws when there is no such one. */
function mustFind(accounts: Account[], accountId: string): Account {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) throw new AppError("INVALID_REQUEST", "No such account.");
  return account;
}

/**
 * Checks a sign-in. Returns the account, or null for both "no such account" and "wrong password" —
 * the caller cannot tell which, and neither can the person at the keyboard.
 *
 * When no account matches, a verification is still run against a throwaway hash. Without it, a
 * missing account would answer in microseconds while a real one takes ~100ms of scrypt, and that
 * gap alone enumerates the deployment's accounts.
 */
export async function authenticate(
  store: JsonStore,
  name: string,
  password: string,
): Promise<Account | null> {
  const account = store.get().accounts.find((a) => sameName(a.name, name));
  const ok = await verifyPassword(password, account?.passwordHash ?? (await decoyHash()));
  return ok && account ? account : null;
}

/**
 * A real scrypt hash of a value nothing can match, used to burn the same time as a genuine
 * verification when the named account does not exist. Produced by {@link hashPassword} so it
 * always carries today's cost parameters — a hand-written constant would drift from them and
 * reopen the timing gap it exists to close.
 *
 * Derived once, on first use rather than at import: this module is imported during boot, and
 * hashing there would add scrypt's cost to every startup including the desktop app's, which
 * never signs anyone in.
 */
let decoy: Promise<string> | null = null;
function decoyHash(): Promise<string> {
  decoy ??= hashPassword(nanoid());
  return decoy;
}
