import type { JsonStore } from "../storage/jsonStore.js";
import type { StateCache } from "./stateCache.js";
import type { ActionRunner } from "./actionRunner.js";
import type { QuotaTracker } from "./quota.js";
import type { FillRequests } from "./fillRequests.js";
import { renderTextPng } from "./titleImage.js";
// DashboardState is the shared API contract for the dashboard state / SSE / webhook payloads.
export type { DashboardState } from "@app/shared";
import { describeIngestion, type DashboardState, type IngestionReadout } from "@app/shared";
import type { IngestionSnapshot } from "@app/shared";

/** Assembles the current state from its sources — the single source of truth for the state
 *  route, the SSE stream, and webhook payloads. */
export function buildDashboardState(
  store: JsonStore,
  cache: StateCache,
  runner: ActionRunner,
  quota: QuotaTracker,
  fills: FillRequests,
): DashboardState {
  const c = cache.snapshot();
  const displayLabel = resolveDisplayLabel(store, c.activePresetId);
  return {
    status: c.status,
    activePresetId: c.activePresetId,
    displayLabel,
    slugPng: renderTextPng(displayLabel, "slug"),
    titlePng: c.status.title ? renderTextPng(c.status.title, "title") : null,
    health: c.health,
    healthMessage: c.healthMessage,
    lastRefreshedAt: c.lastRefreshedAt,
    busy: runner.isBusy(),
    quota: quota.snapshot(),
    undo: c.undoSnapshot
      ? { label: c.undoSnapshot.label, capturedAt: c.undoSnapshot.capturedAt }
      : null,
    apiEnabled: store.get().service.apiEnabled,
    fillRequest: fills.pending(),
    targetConflict: c.targetConflict,
    targetPin: store.get().targetPin,
    ingestion: toIngestionReadout(c.ingestion),
  };
}

/**
 * Attaches the glossary's copy to a raw reading, so every surface says the same words about it
 * (issue 021's rule, applied to issue 059's states). Done here rather than in each consumer
 * because one consumer — the Companion module — is bundled standalone and cannot import the
 * glossary at runtime; a second copy of this mapping is exactly what would drift.
 */
export function toIngestionReadout(snapshot: IngestionSnapshot | null): IngestionReadout | null {
  if (!snapshot) return null;
  const { state, label, meaning, remedy } = describeIngestion(snapshot);
  return { ...snapshot, state, label, meaning, remedy };
}

/**
 * The label shown on a button: the active preset's slug, its id when the slug is unset, or
 * "Custom" when no preset is active (PRD §5.4). Kept out of the cache so editing a preset's
 * slug takes effect immediately without a re-apply.
 */
export function resolveDisplayLabel(store: JsonStore, activePresetId: string | null): string {
  if (!activePresetId) return "Custom";
  const preset = store.get().presets.find((p) => p.id === activePresetId);
  if (!preset) return "Custom";
  return preset.slug.trim() ? preset.slug : preset.id;
}

/**
 * A signature of the fields worth pushing. Excludes `lastRefreshedAt` (a 60s heartbeat that
 * doesn't change anything visible) and buckets quota to ~1% steps so a stream of cheap reads
 * doesn't spam subscribers while still surfacing meaningful budget movement. The base64 PNGs
 * are omitted — they are pure functions of `displayLabel` and `status.title`, both included, so
 * the signature still moves exactly when an image changes without hashing kilobytes of it.
 */
export function changeSignature(s: DashboardState): string {
  const quotaBucket = s.quota.limit > 0 ? Math.floor((s.quota.used / s.quota.limit) * 100) : 0;
  return JSON.stringify([
    s.status.title,
    s.status.privacyStatus,
    s.status.isLive,
    s.status.noTarget,
    s.activePresetId,
    s.displayLabel,
    s.health,
    s.healthMessage,
    s.busy,
    s.undo?.capturedAt ?? null,
    s.apiEnabled,
    quotaBucket,
    s.fillRequest?.id ?? null,
    // The whole conflict, not just its code: the banner names the stray broadcast ids, so a
    // conflict that keeps its code while the ids or count change still has to push.
    s.targetConflict
      ? [s.targetConflict.code, s.targetConflict.message, s.targetConflict.ids]
      : null,
    // Pinning or clearing changes where the next action lands, so it has to reach the dashboard
    // immediately rather than waiting for the next refresh to move something else.
    s.targetPin?.id ?? null,
    // The state, the key it is about, and `checkedAt` bucketed to the minute. The state alone
    // would never push an unchanged answer — and the whole readout turns on its age: the panel
    // prints "read 4 minutes ago" and the Companion feedback exposes `ingestion_checked_at`, so a
    // stamp that freezes at "just now" while the server re-reads every minute is precisely the
    // "the encoder is fine, look, it says receiving" mistake this readout exists to prevent.
    // Bucketing keeps it to the poll cadence rather than a push per millisecond of jitter.
    s.ingestion
      ? [s.ingestion.streamId, s.ingestion.state, Math.floor(Date.parse(s.ingestion.checkedAt) / 60_000)]
      : null,
  ]);
}
