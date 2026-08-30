/**
 * Failed-sign-in throttling (issue 043 acceptance: "failed sign-in attempts are rate-limited").
 *
 * In-memory and per-process, deliberately. Cloudflare rate-limits the edge (issue 042) and this
 * is the origin's own floor underneath it — enough to make an online password guess pointless
 * against a 12-character credential. It resets on restart, which is acceptable for that job and
 * keeps the store free of a write on every failed attempt (a write amplification an attacker
 * would otherwise control).
 */

/** Failures allowed inside the window before the caller is locked out. */
export const MAX_ATTEMPTS = 5;
/** How long the failures are remembered, and how long a lockout lasts. */
export const WINDOW_MS = 15 * 60 * 1000;
/** Cap on tracked keys, so a flood of made-up names cannot grow this map without bound. */
const MAX_KEYS = 10_000;

interface Attempts {
  count: number;
  /** When the current window started; failures older than WINDOW_MS are forgotten. */
  since: number;
}

export interface ThrottleVerdict {
  allowed: boolean;
  /** How long until the caller may try again, for the client's "try again in…" message. */
  retryAfterMs: number;
}

export class LoginThrottle {
  private readonly attempts = new Map<string, Attempts>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Whether this caller may attempt a sign-in right now. */
  check(key: string): ThrottleVerdict {
    const record = this.current(key);
    if (!record || record.count < MAX_ATTEMPTS) return { allowed: true, retryAfterMs: 0 };
    return { allowed: false, retryAfterMs: record.since + WINDOW_MS - this.now() };
  }

  /** Counts a failed attempt. The window starts at the first failure, not the last. */
  recordFailure(key: string): void {
    const record = this.current(key);
    if (record) {
      record.count += 1;
      return;
    }
    if (this.attempts.size >= MAX_KEYS) this.sweep();
    this.attempts.set(key, { count: 1, since: this.now() });
  }

  /** Clears the record — called on a successful sign-in, so one typo costs nothing later. */
  reset(key: string): void {
    this.attempts.delete(key);
  }

  /** The caller's live record, dropping one that has aged out of its window. */
  private current(key: string): Attempts | null {
    const record = this.attempts.get(key);
    if (!record) return null;
    if (this.now() - record.since >= WINDOW_MS) {
      this.attempts.delete(key);
      return null;
    }
    return record;
  }

  private sweep(): void {
    const at = this.now();
    for (const [key, record] of this.attempts) {
      if (at - record.since >= WINDOW_MS) this.attempts.delete(key);
    }
    // Still full of live records: an active flood. Drop the oldest half rather than refuse to
    // track anything new — a stale lockout is worse than a forgotten one.
    if (this.attempts.size >= MAX_KEYS) {
      const oldest = [...this.attempts.entries()]
        .sort((a, b) => a[1].since - b[1].since)
        .slice(0, Math.floor(MAX_KEYS / 2));
      for (const [key] of oldest) this.attempts.delete(key);
    }
  }
}
