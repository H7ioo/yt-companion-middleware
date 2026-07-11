import type { HealthStatus } from "./schema.js";

/**
 * Canonical user-facing vocabulary — the single source of truth for state names and their
 * plain-language meaning (PRD-07 §2, issue 021). Every surface that names a health state — the
 * dashboard rail, the health explainer, the operator guide — draws its copy from here instead of
 * re-writing it, so "degraded" reads the same everywhere and can never drift.
 *
 * This module is the health-state slice of that glossary. Keep the `meaning` text in lockstep with
 * the guide's health table (packages/server/public/guide.html, §07); the guide is static HTML and
 * can't import this at runtime, so the two are aligned by hand and this map is the authority.
 */

/** Which affordance a degraded/offline/auth_error state routes the operator to for a fix. */
export type HealthRemedy = "none" | "retrying" | "firewall" | "reconnect";

export interface HealthTerm {
  /** The display name shown on the rail and in the guide (e.g. "Offline"). */
  label: string;
  /** One plain-language sentence: what this state means, in the operator's terms. */
  meaning: string;
  /** The Companion key colour this state lights, named for the guide table. */
  keyColor: "Green" | "Yellow" | "Grey" | "Red";
  /** How the operator resolves it: self-heals, retries, or links to a specific panel. */
  remedy: HealthRemedy;
}

export const HEALTH_GLOSSARY: Record<HealthStatus, HealthTerm> = {
  ok: {
    label: "Healthy",
    meaning: "Reaching YouTube normally — actions and background polling are working.",
    keyColor: "Green",
    remedy: "none",
  },
  degraded: {
    label: "Degraded",
    meaning: "A recent call failed and the app is retrying. This usually clears on the next poll.",
    keyColor: "Yellow",
    remedy: "retrying",
  },
  offline: {
    label: "Offline",
    meaning:
      "Can't reach YouTube at the network layer — a firewall, DNS, or dropped internet, not a sign-in problem.",
    keyColor: "Grey",
    remedy: "firewall",
  },
  auth_error: {
    label: "Auth error",
    meaning:
      "The saved YouTube sign-in stopped working. No retry will fix it — reconnect to resume actions and status.",
    keyColor: "Red",
    remedy: "reconnect",
  },
};
