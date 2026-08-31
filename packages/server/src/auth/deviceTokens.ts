import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import type { JsonStore } from "../storage/jsonStore.js";
import type { DeviceToken } from "../storage/schema.js";
import { AppError } from "../core/errors.js";

/**
 * Credentials for machines (PRD-15 §2, issue 047).
 *
 * The Companion module runs unattended on a shared machine, so it cannot sign in and its
 * credential lives in a config file anyone at that desk can read. Two consequences shape this
 * module:
 *
 * - **A device token is never an admin.** There is no role to choose. It authenticates, and the
 *   admin guard refuses it on sight (see `Auth.requireAdmin`) — a config file on a shared machine
 *   must be able to run the show and nothing else.
 * - **Revocation is individual.** Cutting off one machine must not take the others down with it,
 *   which is the only reason a token that lives in a file for years is acceptable at all.
 *
 * Only a SHA-256 hash is stored, exactly as for sessions and invites: `store.json` should hand an
 * attacker nothing usable.
 */

/**
 * Granularity of the last-use stamp. The module polls every few seconds and every store write
 * rewrites the whole file; a millisecond-accurate stamp would rewrite it on every request to move
 * a field an admin reads as "recently" or "not for weeks".
 */
export const LAST_USED_GRANULARITY_MS = 5 * 60 * 1000;

/**
 * A visible prefix on the plaintext. It does nothing cryptographically — the entropy is the 32
 * random bytes after it — but a token pasted into the wrong field is recognisable as one, and a
 * leaked string is greppable.
 */
export const TOKEN_PREFIX = "ytm_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Constant-time comparison, so lookup does not leak a token by timing. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export class DeviceTokens {
  private readonly store: JsonStore;
  private readonly now: () => number;

  constructor(store: JsonStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }

  /**
   * Mints a token for a named machine. The plaintext is returned here and nowhere else — it is
   * not recoverable afterwards, so an admin who loses it revokes this one and makes another.
   */
  async create(options: { name: string; createdBy: string }): Promise<{
    token: string;
    record: DeviceToken;
  }> {
    const name = options.name.trim();
    // A nameless token is one nobody can decide whether to revoke, which is the whole job of the
    // list this lands in.
    if (!name) throw new AppError("INVALID_REQUEST", "Give the machine a name.");

    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const at = this.now();
    const record: DeviceToken = {
      id: nanoid(),
      name,
      tokenHash: hashToken(token),
      createdBy: options.createdBy,
      createdAt: new Date(at).toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    };
    await this.store.update((s) => {
      s.deviceTokens = [...s.deviceTokens, record];
    });
    return { token, record };
  }

  /** Every token this deployment has a record of, revoked ones included, newest last. */
  list(): DeviceToken[] {
    return this.store.get().deviceTokens;
  }

  /**
   * Withdraws one machine's credential. The record stays: `lastUsedAt` on a revoked token is what
   * answers "was this the one live on the box we just cut off?" after the fact, and a deleted row
   * answers nothing.
   */
  async revoke(id: string): Promise<DeviceToken> {
    let revoked!: DeviceToken;
    await this.store.update((s) => {
      const record = s.deviceTokens.find((t) => t.id === id);
      if (!record) throw new AppError("INVALID_REQUEST", "No such device token.");
      record.revokedAt ??= new Date(this.now()).toISOString();
      revoked = { ...record };
    });
    return revoked;
  }

  /**
   * Resolves a presented token, or null for anything that is not a live one — unknown, malformed
   * and revoked are one answer, because the caller must not learn which.
   *
   * Touches the last-use stamp on the way past, at {@link LAST_USED_GRANULARITY_MS} granularity.
   */
  async verify(token: string | undefined | null): Promise<DeviceToken | null> {
    if (!token) return null;
    const wanted = hashToken(token);
    const record = this.store.get().deviceTokens.find((t) => hashesMatch(t.tokenHash, wanted));
    if (!record || record.revokedAt) return null;

    const at = this.now();
    if (this.worthStamping(record, at)) {
      await this.store.update((s) => {
        // Re-found inside the update: the record above is a copy of a store that has since moved
        // on, and revocation could have landed in between. Writing through it would resurrect a
        // token an admin has just cut off.
        const live = s.deviceTokens.find((t) => t.id === record.id);
        if (!live || live.revokedAt) return;
        live.lastUsedAt = new Date(at).toISOString();
      });
      // Re-read, so a revocation that raced the stamp above is honoured rather than ignored.
      const after = this.store.get().deviceTokens.find((t) => t.id === record.id);
      if (!after || after.revokedAt) return null;
      return after;
    }
    return record;
  }

  /** Whether the last-use stamp has drifted far enough to be worth a whole-store rewrite. */
  private worthStamping(record: DeviceToken, at: number): boolean {
    if (!record.lastUsedAt) return true;
    return at - Date.parse(record.lastUsedAt) >= LAST_USED_GRANULARITY_MS;
  }
}
