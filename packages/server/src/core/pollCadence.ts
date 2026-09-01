import type { CacheState } from "../storage/schema.js";

/**
 * How often to poll while a latch is armed and a go-live is plausible (PRD-14 §Solution).
 *
 * Five seconds would shave two seconds off a worst case that is already only a few seconds, at
 * double the cost. Ten keeps the observed wrong-title window comfortably under the ~15s the
 * 2026-08-05 live test demonstrated as acceptable.
 */
export const FAST_POLL_INTERVAL_MS = 10_000;

/** What one fast tick costs: a single `liveBroadcasts.list` read, versus 3–4 for a full refresh. */
export const FAST_PROBE_COST_UNITS = 1;

/**
 * How long fast probing lasts, measured from `pendingMetadata.capturedAt`.
 *
 * Quota arithmetic: 30 min at one 1-unit probe per 10s is 180 units — under 2% of the 10,000/day
 * budget, and it covers the realistic "set the title, then start the encoder" gap. Arming three
 * hours early degrades to the normal 60s poll rather than costing 1,000+ units, and arming early
 * is never worse than arming late because the latch itself outlives this window.
 */
export const FAST_POLL_WINDOW_MS = 30 * 60 * 1000;

export interface CadenceInput {
  cache: CacheState;
  /** The API kill switch. Off means no YouTube calls at all, so there is nothing to hurry for. */
  apiEnabled: boolean;
  /** The steady-state interval, i.e. `REFRESH_INTERVAL_SECONDS`. */
  normalIntervalMs: number;
  now: number;
}

/**
 * How long until the next poll. A pure function of the snapshot so the cadence can be tested
 * without timers, and so the timer itself stays dumb (PRD-14 §Implementation Decisions).
 */
export function pollIntervalMs(input: CadenceInput): number {
  if (!isFastWindow(input)) return input.normalIntervalMs;
  // A deployment already polling faster than the fast interval wants that speed; never slow it.
  return Math.min(FAST_POLL_INTERVAL_MS, input.normalIntervalMs);
}

/** Whether the conditions for fast probing all hold right now. */
export function isFastWindow({ cache, apiEnabled, now }: CadenceInput): boolean {
  if (!apiEnabled) return false;
  const pending = cache.pendingMetadata;
  if (!pending) return false;
  if (cache.status.isLive) return false;
  const capturedAt = Date.parse(pending.capturedAt);
  if (Number.isNaN(capturedAt)) return false;
  return now - capturedAt <= FAST_POLL_WINDOW_MS;
}
