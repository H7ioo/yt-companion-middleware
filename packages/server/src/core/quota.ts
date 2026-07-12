import type { youtube_v3 } from "googleapis";
import type { JsonStore } from "../storage/jsonStore.js";
import type { StateEvents } from "./events.js";
import type { Logger } from "./logger.js";

/** Percent of the daily budget at which we log a one-time mid-stream warning. */
const QUOTA_WARN_PERCENT = 90;

/**
 * Cost-weighted YouTube Data API quota tracking.
 *
 * YouTube bills per method, not per call: reads (`list`) cost 1 unit, writes
 * (`update`/`bind`/`insert`) cost 50. The default daily budget is 10,000 units and it
 * resets at midnight US-Pacific. This tracker records the *attempted* cost of every call
 * we make so the dashboard and Companion can warn before the budget runs out mid-stream.
 *
 * Recording on attempt (rather than only on success) is deliberately conservative — YouTube
 * charges for most rejected requests too, and over-counting is safer than a surprise 403.
 */
export const QUOTA_COST = { read: 1, write: 50 } as const;

// QuotaSnapshot is part of the shared API contract (surfaced on the dashboard state).
export type { QuotaSnapshot } from "@app/shared";
import type { QuotaSnapshot } from "@app/shared";

/** Current calendar day in US-Pacific, where the YouTube quota window resets. */
export function pacificDate(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export class QuotaTracker {
  private used = 0;
  private date = pacificDate();
  private persistTimer: NodeJS.Timeout | null = null;
  private lastBucket = 0;
  private warned = false;

  constructor(
    private readonly store: JsonStore,
    private readonly limit: number,
    private readonly events?: StateEvents,
    private readonly logger?: Logger,
    // Injectable clock so tests can cross a Pacific-midnight boundary; defaults to the wall clock.
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Coarse ~1% budget bucket; used to push a change only when it visibly moves. */
  private bucket(): number {
    return this.limit > 0 ? Math.floor((this.used / this.limit) * 100) : 0;
  }

  /** Seed in-memory counters from the persisted store, discarding a stale (prior-day) count. */
  init(): void {
    const q = this.store.get().quota;
    const today = pacificDate(this.now());
    if (q.date === today) {
      this.used = q.used;
      this.date = q.date;
    } else {
      this.used = 0;
      this.date = today;
    }
    this.lastBucket = this.bucket();
  }

  /** Add `cost` units. Rolls the counter to zero when the PT day has turned over. */
  record(cost: number): void {
    this.rollDate();
    this.used += cost;
    this.schedulePersist();
    const bucket = this.bucket();
    if (bucket !== this.lastBucket) {
      this.lastBucket = bucket;
      this.events?.emitChange();
    }
    // A one-time mid-stream heads-up before the budget runs out and writes start 403-ing.
    if (!this.warned && bucket >= QUOTA_WARN_PERCENT) {
      this.warned = true;
      this.logger?.push({
        level: "warn",
        category: "quota",
        code: "YOUTUBE_QUOTA_LOW",
        message: `YouTube quota at ${bucket}% of the daily budget`,
      });
    }
  }

  snapshot(): QuotaSnapshot {
    this.rollDate();
    return {
      date: this.date,
      used: this.used,
      limit: this.limit,
      remaining: Math.max(0, this.limit - this.used),
    };
  }

  private rollDate(): void {
    const today = pacificDate(this.now());
    if (today !== this.date) {
      this.date = today;
      this.used = 0;
      // Reset the mid-stream warning latch alongside usage so the 90% heads-up can fire again on
      // the new day — otherwise a long-running server warns once, ever (PRD-10 §4). In-memory only;
      // a mid-day restart re-warning once is acceptable.
      this.warned = false;
      this.schedulePersist();
    }
  }

  /** Debounced write-through so a burst of calls costs a single store write. */
  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const { date, used } = this;
      void this.store.update((s) => {
        s.quota = { date, used };
      });
    }, 250);
    // Don't keep the process alive just to flush the counter.
    this.persistTimer.unref?.();
  }
}

/**
 * Wraps the YouTube client methods we call so each invocation records its quota cost.
 * Patches in place; the returned client is the same instance.
 */
export function instrumentQuota(yt: youtube_v3.Youtube, tracker: QuotaTracker): youtube_v3.Youtube {
  // The googleapis methods are heavily overloaded, so the wrapper is typed loosely and
  // cast back to each method's exact signature at the assignment site.
  const meter =
    <T>(fn: T, cost: number): T =>
    ((...args: unknown[]) => {
      tracker.record(cost);
      return (fn as (...a: unknown[]) => unknown)(...args);
    }) as T;

  const b = yt.liveBroadcasts;
  b.list = meter(b.list.bind(b), QUOTA_COST.read);
  b.update = meter(b.update.bind(b), QUOTA_COST.write);
  b.bind = meter(b.bind.bind(b), QUOTA_COST.write);
  const v = yt.videos;
  v.list = meter(v.list.bind(v), QUOTA_COST.read);
  v.update = meter(v.update.bind(v), QUOTA_COST.write);
  if (yt.liveStreams) {
    const s = yt.liveStreams;
    s.list = meter(s.list.bind(s), QUOTA_COST.read);
  }

  return yt;
}
