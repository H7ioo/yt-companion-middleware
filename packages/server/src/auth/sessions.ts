import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import type { JsonStore } from "../storage/jsonStore.js";
import type { Account, Session } from "../storage/schema.js";

/**
 * Server-side sessions for the hosted deployment (issue 043, policy settled in issue 042).
 *
 * Sessions live in the same JSON store as everything else rather than in memory, so a server
 * restart — which happens on every credential change (see server.ts) — does not sign everyone
 * out. The cookie carries an opaque token; the store keeps only its SHA-256 hash.
 *
 * The clock is injected so the 30/90-day behaviour is testable without waiting three months.
 */

/** Idle timeout: a session unused for this long is dead. Refreshed on every authenticated request. */
export const IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** Absolute cap: fixed at creation, unextendable by activity. Only re-authentication resets it. */
export const ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;
/** How far ahead of the cap a session starts reporting itself as expiring, so the UI can warn. */
export const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Granularity of the idle-clock refresh. Every write rewrites the whole store.json, and the
 * window it feeds is thirty days — recording activity to the millisecond would rewrite the file
 * on every authenticated request to move a deadline that only matters at day granularity.
 */
export const LAST_SEEN_GRANULARITY_MS = 5 * 60 * 1000;

/** Who is asking — the seam issues 044, 047 and 050 all resolve their caller through. */
export interface Actor {
  account: Account;
  session: Session;
  /** Within {@link EXPIRING_WINDOW_MS} of the absolute cap: the dashboard prompts to re-auth. */
  expiringSoon: boolean;
  /** When the absolute cap falls, so the notice can say "in three days" rather than "soon". */
  absoluteExpiresAt: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Constant-time comparison of two token hashes, so lookup does not leak by timing. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export class Sessions {
  private readonly store: JsonStore;
  private readonly now: () => number;

  constructor(store: JsonStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }

  /**
   * Issues a session for an account. The returned token is the only time the plaintext exists —
   * it goes straight into the cookie and is never persisted or logged.
   */
  async create(accountId: string): Promise<{ token: string; session: Session }> {
    const token = randomBytes(32).toString("base64url");
    const at = this.now();
    const session: Session = {
      id: nanoid(),
      accountId,
      tokenHash: hashToken(token),
      createdAt: new Date(at).toISOString(),
      lastSeenAt: new Date(at).toISOString(),
      absoluteExpiresAt: new Date(at + ABSOLUTE_MS).toISOString(),
    };
    await this.store.update((s) => {
      // Sweep dead sessions on the way past, so the store does not grow a tail of expired
      // records that nothing else would ever clean up.
      s.sessions = [...this.live(s.sessions, at), session];
    });
    return { token, session };
  }

  /**
   * Resolves a cookie token to its actor, refreshing the idle clock as a side effect — that
   * refresh is what "30 days idle" means. Returns null for an unknown, idle-expired or
   * capped-out token, and for a session whose account has since been removed.
   */
  async resolve(token: string | undefined): Promise<Actor | null> {
    if (!token) return null;
    const at = this.now();
    const wanted = hashToken(token);
    const current = this.store.get();
    const session = current.sessions.find((s) => hashesMatch(s.tokenHash, wanted));
    if (!session || !this.isLive(session, at)) return null;
    const account = current.accounts.find((a) => a.id === session.accountId);
    if (!account) return null;

    // Only persist once the stored stamp has actually gone stale; see LAST_SEEN_GRANULARITY_MS.
    const stale = at - Date.parse(session.lastSeenAt) >= LAST_SEEN_GRANULARITY_MS;
    const lastSeenAt = stale ? new Date(at).toISOString() : session.lastSeenAt;
    if (stale) {
      await this.store.update((s) => {
        const record = s.sessions.find((x) => x.id === session.id);
        if (record) record.lastSeenAt = lastSeenAt;
      });
    }

    const capAt = Date.parse(session.absoluteExpiresAt);
    return {
      account,
      session: { ...session, lastSeenAt },
      expiringSoon: capAt - at <= EXPIRING_WINDOW_MS,
      absoluteExpiresAt: session.absoluteExpiresAt,
    };
  }

  /** Invalidates a session — sign-out. Unknown tokens are a no-op, not an error. */
  async revoke(token: string | undefined): Promise<void> {
    if (!token) return;
    const wanted = hashToken(token);
    await this.store.update((s) => {
      s.sessions = s.sessions.filter((x) => !hashesMatch(x.tokenHash, wanted));
    });
  }

  /**
   * Trades a still-valid session for a fresh one with a new absolute clock, for a browser that is
   * already signed in and approaching the 90-day cap. The old session is revoked in the same
   * step, so the cap can never be laundered into an endless chain of overlapping sessions.
   */
  async reauthenticate(token: string | undefined): Promise<{ token: string; session: Session } | null> {
    const actor = await this.resolve(token);
    if (!actor) return null;
    const issued = await this.create(actor.account.id);
    await this.revoke(token);
    return issued;
  }

  /**
   * The live sessions of one account — the devices an admin can see and cut off (issue 046).
   * Dead ones are filtered rather than returned greyed out: a session that has already lapsed is
   * not a device anyone needs to decide about.
   */
  listFor(accountId: string): Session[] {
    const at = this.now();
    return this.live(
      this.store.get().sessions.filter((s) => s.accountId === accountId),
      at,
    );
  }

  /**
   * Cuts off **one** device without disturbing the others — the lost-phone case, and the reason a
   * 90-day session is acceptable at all (PRD-15 §2).
   *
   * Scoped to the account on purpose: the route below reaches this with an id from the URL, and
   * an id alone would let a mistyped path revoke a session belonging to someone else entirely.
   */
  async revokeById(accountId: string, sessionId: string): Promise<boolean> {
    let removed = false;
    await this.store.update((s) => {
      const before = s.sessions.length;
      s.sessions = s.sessions.filter((x) => !(x.id === sessionId && x.accountId === accountId));
      removed = s.sessions.length < before;
    });
    return removed;
  }

  /** Drops every session belonging to an account — used when an account is removed (issue 046). */
  async revokeAllFor(accountId: string): Promise<void> {
    await this.store.update((s) => {
      s.sessions = s.sessions.filter((x) => x.accountId !== accountId);
    });
  }

  private isLive(session: Session, at: number): boolean {
    return (
      at - Date.parse(session.lastSeenAt) < IDLE_MS && at < Date.parse(session.absoluteExpiresAt)
    );
  }

  private live(sessions: Session[], at: number): Session[] {
    return sessions.filter((s) => this.isLive(s, at));
  }
}
