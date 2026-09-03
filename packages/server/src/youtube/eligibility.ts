import type { JsonStore } from "../storage/jsonStore.js";
import { AppError } from "../core/errors.js";

/**
 * Riding-mode detection (PRD-16 §6, issue 061).
 *
 * YouTube blocks broadcast creation on channels it considers ineligible — the 50-subscriber
 * threshold is the usual cause, but the threshold is YouTube's policy and not ours to re-implement.
 * A subscriber count would be a guess that goes stale the day the policy moves; the refusal
 * `liveBroadcasts.insert` returns is the answer itself, costs no extra API surface, and is checkable
 * afterwards because it is stored verbatim.
 *
 * The mode is a fact about the *channel*, so it is recorded once and kept, not recomputed per call.
 */

/**
 * The refusal reasons that mean "this channel may not create broadcasts". All three are 403s.
 * Anything else — a quota refusal, a bare 403, a 5xx, a dead socket — says nothing about
 * eligibility and must leave the recorded mode alone.
 */
export const ELIGIBILITY_REASONS = [
  "insufficientLivePermissions",
  "livePermissionBlocked",
  "liveStreamingNotEnabled",
] as const;

export type EligibilityReason = (typeof ELIGIBILITY_REASONS)[number];

/**
 * The eligibility reason a googleapis error carries, or null when it carries none.
 *
 * Gated on an actual 403 rather than on the reason string alone. Without the status check a
 * proxy's error page or a 5xx that happened to echo the request would be enough to put a
 * perfectly eligible channel into riding mode permanently — and riding mode disables the feature,
 * so a false positive here is worse than no detection at all.
 */
export function eligibilityRefusal(err: unknown): EligibilityReason | null {
  const e = err as {
    code?: number | string;
    status?: number;
    response?: { status?: number; data?: { error?: { errors?: Array<{ reason?: string }> } } };
  };
  // Same status hunt as `mapYouTubeError`: googleapis puts the code on `response.status` most of
  // the time, but a bare `status`/`code` is common enough that reading only the first would send
  // a real refusal down the auth path and raise a reconnect banner no reconnect can clear.
  if (Number(e?.response?.status ?? e?.status ?? e?.code) !== 403) return null;
  const reasons = e.response?.data?.error?.errors?.map((x) => x.reason ?? "") ?? [];
  return (
    (ELIGIBILITY_REASONS as readonly string[]).find((r) => reasons.includes(r)) as
      | EligibilityReason
      | undefined
  ) ?? null;
}

/** True for the classified refusal — i.e. after `mapYouTubeError` has named it. */
export function isEligibilityError(err: unknown): boolean {
  return err instanceof AppError && err.code === "LIVE_NOT_ELIGIBLE";
}

/**
 * Records that YouTube refused to let this channel create a broadcast.
 *
 * Idempotent by design: the poll loop can meet the same refusal every minute, and re-stamping
 * `checkedAt` each time would present a months-old finding as something that just happened. The
 * first observation is the one that dates it.
 *
 * Returns true only when this call actually changed the stored mode, so callers can log and
 * notify on the transition rather than on every poll that meets the same standing refusal.
 */
export async function noteRidingMode(
  store: JsonStore,
  obs: { reason: string; message: string | null; now: string },
): Promise<boolean> {
  const held = store.get().liveEligibility;
  if (held.mode === "riding" && held.reason === obs.reason) return false;
  await store.update((s) => {
    s.liveEligibility = {
      mode: "riding",
      reason: obs.reason,
      message: obs.message,
      checkedAt: obs.now,
    };
  });
  return true;
}

/**
 * Records that a broadcast creation actually succeeded — the only proof that the channel is
 * eligible. Clears the stored refusal: a channel that has crossed the threshold is no longer
 * refused, and leaving yesterday's reason next to "driving" would read as a live complaint.
 */
export async function noteDriving(store: JsonStore, now: string): Promise<void> {
  if (store.get().liveEligibility.mode === "driving") return;
  await store.update((s) => {
    s.liveEligibility = { mode: "driving", reason: null, message: null, checkedAt: now };
  });
}

/**
 * Forgets what was learned, because it was learned about a different connection. Called when the
 * credentials change: reconnecting is often reconnecting to another channel, and carrying the old
 * channel's refusal across would disable creation on a channel that never refused anything.
 */
export async function resetEligibility(store: JsonStore): Promise<void> {
  if (store.get().liveEligibility.mode === "unknown") return;
  await store.update((s) => {
    s.liveEligibility = { mode: "unknown", reason: null, message: null, checkedAt: null };
  });
}
