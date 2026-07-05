import type { HealthStatus } from "../storage/schema.js";

export interface HealthState {
  status: HealthStatus;
  message: string | null;
  /** Consecutive transient failures (reset on success or auth error). */
  consecutiveFailures: number;
}

export function initialHealth(): HealthState {
  return { status: "ok", message: null, consecutiveFailures: 0 };
}

/** A successful refresh clears everything back to healthy. */
export function onSuccess(_prev: HealthState): HealthState {
  return { status: "ok", message: null, consecutiveFailures: 0 };
}

/**
 * Health escalation (PRD §5.4). Transient failures escalate ok -> degraded and only
 * reach auth_error after `threshold` consecutive failures — this avoids button flicker
 * from a single network blip. An auth failure is not retry-recoverable, so it jumps
 * straight to auth_error.
 */
export function onFailure(
  prev: HealthState,
  opts: { isAuthError: boolean; threshold: number; message?: string | null },
): HealthState {
  const message = opts.message ?? null;
  if (opts.isAuthError) {
    return { status: "auth_error", message, consecutiveFailures: prev.consecutiveFailures + 1 };
  }
  const consecutiveFailures = prev.consecutiveFailures + 1;
  const status: HealthStatus = consecutiveFailures >= opts.threshold ? "auth_error" : "degraded";
  return { status, message, consecutiveFailures };
}
