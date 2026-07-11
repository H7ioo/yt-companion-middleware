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
 * How a failed refresh is classified, which decides where health lands (PRD-06 §1):
 * - `auth`      — 401/403 auth reason; the token is dead and needs reauth.
 * - `network`   — transport-level failure (firewall / DNS / no internet).
 * - `transient` — any other/unclassified error (e.g. a 5xx).
 */
export type FailureKind = "auth" | "network" | "transient";

/**
 * Health escalation (PRD-06 §1). Non-auth failures escalate ok -> degraded first, so a single
 * blip never flips a button. Only two things escalate past degraded:
 * - an `auth` failure jumps straight to `auth_error` (not retry-recoverable), and
 * - repeated `network` failures reach `offline` after `threshold` — never `auth_error`, so a
 *   firewall is no longer mislabeled as a dead token (fixes PRD-06 §0).
 * An unclassified `transient` failure stays `degraded` indefinitely rather than guessing.
 */
export function onFailure(
  prev: HealthState,
  opts: { kind: FailureKind; threshold: number; message?: string | null },
): HealthState {
  const message = opts.message ?? null;
  const consecutiveFailures = prev.consecutiveFailures + 1;
  if (opts.kind === "auth") {
    return { status: "auth_error", message, consecutiveFailures };
  }
  let status: HealthStatus = "degraded";
  if (opts.kind === "network" && consecutiveFailures >= opts.threshold) {
    status = "offline";
  }
  return { status, message, consecutiveFailures };
}
