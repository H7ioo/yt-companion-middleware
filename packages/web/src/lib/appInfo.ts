import type { AppInfo } from "../api.js";

/**
 * True when a freshly polled {@link AppInfo} differs in a field the dashboard actually renders: the
 * running version, and the updater's status / offered version / offered notes (PRD-11 §2). The 60s
 * app-info poll returns a fresh object every tick even when nothing changed; gating `setAppInfo` on
 * this keeps the root React tree from reconciling for a byte-identical payload — the update state
 * only moves when a download progresses, which is minutes apart at most.
 */
export function appInfoChanged(prev: AppInfo | null, next: AppInfo): boolean {
  if (!prev) return true;
  return (
    prev.version !== next.version ||
    prev.update.status !== next.update.status ||
    prev.update.version !== next.update.version ||
    prev.update.notes !== next.update.notes ||
    prev.update.error !== next.update.error
  );
}
