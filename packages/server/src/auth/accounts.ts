import { nanoid } from "nanoid";
import type { JsonStore } from "../storage/jsonStore.js";
import type { Account } from "../storage/schema.js";
import { hashPassword, verifyPassword } from "./passwords.js";

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

/** The shortest password the seed will accept. A seeded admin is the deployment's master key. */
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
