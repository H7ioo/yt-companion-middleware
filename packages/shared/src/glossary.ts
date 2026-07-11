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

/**
 * The broadcast-state slice of the glossary: what the operator's stream is doing right now.
 * Distinct from health (can we reach YouTube) — a healthy app can be idle, an offline app was
 * last seen live. Every surface that names this state — the dashboard tally, the Companion "On Air"
 * feedback, the guide — draws from {@link describeBroadcastState} so "On Air" never drifts back to
 * "on air" / "Standby" / "Live" the way it did before issue 021.
 */
export interface BroadcastState {
  /** Display name for the current state ("On Air", "Idle"). */
  label: string;
  /** Short uppercase tally badge ("LIVE", "IDLE"). */
  badge: string;
}

/** The status flags the dashboard already holds, narrowed to what names the broadcast state. */
export interface BroadcastStatusFlags {
  isLive: boolean;
  noTarget: boolean;
}

/** Canonical broadcast-state names, keyed for anywhere that can't call the resolver at runtime. */
export const BROADCAST_STATE = {
  live: { label: "On Air", badge: "LIVE" },
  idle: { label: "Idle", badge: "IDLE" },
} as const satisfies Record<string, BroadcastState>;

/** Resolve the canonical broadcast state from the cached status flags (issue 021). */
export function describeBroadcastState(status: BroadcastStatusFlags): BroadcastState {
  return status.isLive ? BROADCAST_STATE.live : BROADCAST_STATE.idle;
}

/**
 * The action slice of the glossary: the operator actions PRD-07 §2 (#10) enumerates — apply a
 * preset, update metadata, toggle privacy, undo, and the two refreshes the guide is careful to
 * keep apart. `endpoint` is the POST route Companion and the dashboard fire; `refreshLists` is a
 * client-side re-fetch of the picker lists, not a POST, so its endpoint is null. Naming both here
 * is what stops "Refresh from YouTube" / "Refresh cache" / "Refresh" drifting across surfaces.
 */
export interface ActionTerm {
  label: string;
  endpoint: string | null;
}

export const ACTION_GLOSSARY = {
  applyPreset: { label: "Apply preset", endpoint: "/api/action/preset" },
  update: { label: "Update live metadata", endpoint: "/api/action/update" },
  privacyToggle: { label: "Toggle privacy", endpoint: "/api/action/privacy" },
  undo: { label: "Undo last change", endpoint: "/api/action/undo" },
  refreshState: { label: "Refresh from YouTube", endpoint: "/api/action/refresh" },
  refreshLists: { label: "Refresh lists", endpoint: null },
} as const satisfies Record<string, ActionTerm>;

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
