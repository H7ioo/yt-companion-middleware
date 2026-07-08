import { Router } from "express";
import type { AppContext } from "./context.js";

/**
 * Feedback endpoints (PRD §5.4). Served entirely from the in-app cache — never a live
 * YouTube call — so Companion polling every 5s costs zero YouTube quota.
 */
export function feedbackRouter(ctx: AppContext): Router {
  const router = Router();

  // A superset endpoint: the active preset plus the core status/health/busy signals, so a
  // Companion button can bind text, on-air colour, health lamp and the active-preset
  // highlight from a single poll instead of hitting /status, /busy and /health separately.
  // The narrow endpoints below stay for buttons that only need one field.
  router.get("/active-preset", (_req, res) => {
    const c = ctx.cache.snapshot();
    const q = ctx.quota.snapshot();
    // The saved preset that was last applied, so Companion can label/inspect the active key
    // without a second call to /api/dashboard/presets. null when none is active or the preset
    // has since been deleted. `title` below stays the live broadcast title, not the preset's.
    const activePreset =
      c.activePresetId != null
        ? (ctx.store.get().presets.find((p) => p.id === c.activePresetId) ?? null)
        : null;
    res.json({
      activePresetId: c.activePresetId,
      activePreset,
      title: c.status.title,
      privacyStatus: c.status.privacyStatus,
      isLive: c.status.isLive,
      noTarget: c.status.noTarget,
      busy: ctx.runner.isBusy(),
      health: c.health,
      apiEnabled: ctx.store.get().service.apiEnabled,
      quotaRemaining: q.remaining,
    });
  });

  router.get("/status", (_req, res) => {
    const { status } = ctx.cache.snapshot();
    res.json({
      title: status.title,
      privacyStatus: status.privacyStatus,
      isLive: status.isLive,
    });
  });

  router.get("/busy", (_req, res) => {
    res.json({ busy: ctx.runner.isBusy() });
  });

  router.get("/health", (_req, res) => {
    const cache = ctx.cache.snapshot();
    const quota = ctx.quota.snapshot();
    res.json({
      status: cache.health,
      authenticated: cache.health !== "auth_error",
      message: cache.healthMessage,
      quotaUsed: quota.used,
      quotaLimit: quota.limit,
      quotaRemaining: quota.remaining,
    });
  });

  return router;
}
