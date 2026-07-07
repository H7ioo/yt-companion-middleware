import type { JsonStore } from "../storage/jsonStore.js";
import type { StateCache } from "./stateCache.js";
import type { ActionRunner } from "./actionRunner.js";
import type { QuotaTracker, QuotaSnapshot } from "./quota.js";

/** The full operational state pushed to the dashboard and outbound webhooks. */
export interface DashboardState {
  status: {
    title: string | null;
    privacyStatus: string | null;
    isLive: boolean;
    noTarget: boolean;
  };
  activePresetId: string | null;
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
  return {
    status: c.status,
    activePresetId: c.activePresetId,
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
 * A signature of the fields worth pushing. Excludes `lastRefreshedAt` (a 60s heartbeat that
 * doesn't change anything visible) and buckets quota to ~1% steps so a stream of cheap reads
 * doesn't spam subscribers while still surfacing meaningful budget movement.
 */
export function changeSignature(s: DashboardState): string {
  const quotaBucket = s.quota.limit > 0 ? Math.floor((s.quota.used / s.quota.limit) * 100) : 0;
  return JSON.stringify([
    s.status.title,
    s.status.privacyStatus,
    s.status.isLive,
    s.status.noTarget,
    s.activePresetId,
    s.health,
    s.healthMessage,
    s.busy,
    s.undo?.capturedAt ?? null,
    s.apiEnabled,
    quotaBucket,
  ]);
}
