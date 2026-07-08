import type { JsonStore } from "../storage/jsonStore.js";
import type { StateCache } from "./stateCache.js";
import type { ActionRunner } from "./actionRunner.js";
import type { QuotaTracker, QuotaSnapshot } from "./quota.js";
import { renderTextPng } from "./titleImage.js";

/** The full operational state pushed to the dashboard and outbound webhooks. */
export interface DashboardState {
  status: {
    title: string | null;
    privacyStatus: string | null;
    isLive: boolean;
    noTarget: boolean;
  };
  activePresetId: string | null;
  /**
   * Short button label safe for Companion's Latin fonts: the active preset's slug, or its id
   * when the slug is unset, or "Custom" when no preset is active (PRD §5.4). A button binds
   * this instead of `status.title` to avoid Arabic rendering as boxes.
   */
  displayLabel: string;
  /**
   * Base64 PNG (no data-URI prefix) of `displayLabel`, and of the full `status.title`,
   * rendered with an Arabic-capable font so a button can show either as an image — sidestepping
   * Companion's tofu boxes entirely. null when there is no text to draw or rendering is
   * unavailable. A button typically toggles between the two (slug fits; full title may not).
   */
  slugPng: string | null;
  titlePng: string | null;
  health: "ok" | "degraded" | "auth_error";
  healthMessage: string | null;
  lastRefreshedAt: string | null;
  busy: boolean;
  quota: QuotaSnapshot;
  undo: { label: string | null; capturedAt: string } | null;
  /** Master API switch — false means the middleware is making no YouTube calls (PRD kill-switch). */
  apiEnabled: boolean;
}

/** Assembles the current state from its sources — the single source of truth for the state
 *  route, the SSE stream, and webhook payloads. */
export function buildDashboardState(
  store: JsonStore,
  cache: StateCache,
  runner: ActionRunner,
  quota: QuotaTracker,
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
  };
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
  ]);
}
