import type { HealthStatus, TargetConflict } from "./schema.js";

/**
 * Canonical user-facing vocabulary — the single source of truth for state names and their
 * plain-language meaning (PRD-07 §2, issue 021). Every surface that names a health state — the
 * dashboard rail, the health explainer, the operator guide — draws its copy from here instead of
 * re-writing it, so "degraded" reads the same everywhere and can never drift.
 *
 * This module is the health-state slice of that glossary. Keep the `meaning` text in lockstep with
 * the guide's health table (packages/server/public/guide/api.html, §07); the guide is static HTML and
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

/**
 * The target-conflict slice of the glossary: the app is reaching YouTube fine, but the broadcast
 * it edits may not be the one that airs. Deliberately not a health state — health answers "can we
 * reach YouTube", this answers "are we pointed at the right thing", and folding the two together
 * would make a perfectly-connected app read as broken.
 *
 * `label` names the state; the specific counts and titles ride on the conflict's own `message`,
 * because those are per-channel facts the server discovers rather than fixed vocabulary.
 */
export interface TargetConflictTerm {
  label: string;
  /** What the operator does about it, in one sentence. */
  remedy: string;
}

export const TARGET_CONFLICT_GLOSSARY: Record<TargetConflict["code"], TargetConflictTerm> = {
  SHARED_STREAM_KEY: {
    label: "Two broadcasts share your stream key",
    remedy: "Delete the one you are not starting, then refresh.",
  },
  MULTIPLE_UPCOMING: {
    label: "More than one broadcast is waiting",
    remedy: "Delete the strays in YouTube Studio, then refresh.",
  },
  TARGET_DRIFT: {
    label: "The broadcast being edited changed on its own",
    remedy: "Close Studio's stream page so it stops creating broadcasts, then refresh.",
  },
  PINNED_TARGET_GONE: {
    label: "The broadcast you pinned no longer exists",
    remedy: "Pick the broadcast to edit again, or clear the pin to go back to automatic.",
  },
};

/**
 * The ingestion slice of the glossary: is video actually arriving at YouTube right now?
 * (PRD-16 §3, issue 059.)
 *
 * This is the readout that replaces the single most common mid-show Studio trip — "is it stuck on
 * preparing?" — and it is deliberately its own vocabulary rather than a health state. Health
 * answers "can this app reach YouTube"; this answers "can YouTube see the encoder". The two are
 * independent in both directions: a perfectly healthy app watches a stream nothing is arriving on,
 * and an app that has lost its own connection says nothing at all about what OBS is pushing.
 *
 * It is also not the embedded player (issue 065). That is the audience's delayed view; this is the
 * live signal, and conflating them is how an operator concludes the stream is fine because a
 * twenty-second-old frame is still playing.
 */
export type IngestionState = "receiving" | "problems" | "no-data" | "unknown";

export interface IngestionTerm {
  /** Display name for the state ("Receiving video"). */
  label: string;
  /** One plain-language sentence: what YouTube is seeing, in the operator's terms. */
  meaning: string;
  /** The Companion key colour this state lights, named for the guide table. */
  keyColor: "Green" | "Yellow" | "Grey" | "Red";
  /** What the operator does about it, in one sentence. */
  remedy: string;
}

export const INGESTION_GLOSSARY: Record<IngestionState, IngestionTerm> = {
  receiving: {
    label: "Receiving video",
    meaning: "YouTube is getting the encoder's video on this key right now.",
    keyColor: "Green",
    remedy: "Nothing to do — the encoder is through.",
  },
  problems: {
    label: "Arriving with problems",
    meaning:
      "Video is reaching YouTube on this key, but YouTube is unhappy with it — bitrate, frame rate or a dropped connection.",
    keyColor: "Yellow",
    remedy: "Check the encoder's bitrate and network before the show; viewers may see buffering.",
  },
  "no-data": {
    label: "Nothing arriving",
    meaning: "YouTube is seeing no video on this key — the encoder is not pushing, or is pushing somewhere else.",
    keyColor: "Red",
    remedy: "Start the encoder, and check it is pushing to this key rather than another one.",
  },
  unknown: {
    label: "Not known",
    meaning: "YouTube has not said what it is seeing on this key — nothing has been read yet, or it answered with something this app does not recognise.",
    keyColor: "Grey",
    remedy: "Re-check, and if it persists open YouTube Studio for the authoritative answer.",
  },
};

/** The raw ingestion fields, exactly as `liveStreams.list` reports them. */
export interface IngestionStatusFields {
  /** `status.streamStatus`: active | created | error | inactive | ready. */
  streamStatus: string | null;
  /** `status.healthStatus.status`: good | ok | bad | noData. */
  healthStatus: string | null;
}

/**
 * Resolves the canonical ingestion state from YouTube's two raw fields, and hands back the copy
 * for it so a surface needs one call rather than a classify-then-look-up pair.
 *
 * Pure and total: an unrecognised value from either field resolves to `unknown` rather than being
 * quietly bucketed into a state that reads as an answer. YouTube has changed this vocabulary
 * before, and "we do not know" is the only honest thing to print when it does.
 */
export function describeIngestion(
  fields: IngestionStatusFields,
): IngestionTerm & { state: IngestionState } {
  const state = ingestionState(fields);
  return { state, ...INGESTION_GLOSSARY[state] };
}

function ingestionState({ streamStatus, healthStatus }: IngestionStatusFields): IngestionState {
  // An explicit ingestion error outranks whatever health last said: `healthStatus` can still read
  // `good` from before the encoder fell over, and reporting that would be worse than saying
  // nothing.
  if (streamStatus === "error") return "problems";
  if (streamStatus === "active") {
    // `active` is the primary signal — data is arriving — so an absent or unrecognised health
    // reading downgrades the detail, not the answer.
    if (healthStatus === "bad") return "problems";
    // Contradictory, and YouTube does report it in the seconds after the encoder stops: the
    // stream is still marked active while no data is coming in. The absence of data is the fact
    // the operator needs.
    if (healthStatus === "noData") return "no-data";
    if (healthStatus === "good" || healthStatus === "ok" || healthStatus === null) return "receiving";
    return "unknown";
  }
  // Every other state YouTube defines means the same thing to an operator: the key exists and
  // nothing is coming in on it. Why it is idle (never used, previously used, waiting) is detail
  // the panel can show from the raw values; it is not a different answer.
  if (streamStatus === "ready" || streamStatus === "inactive" || streamStatus === "created") {
    return "no-data";
  }
  return "unknown";
}
