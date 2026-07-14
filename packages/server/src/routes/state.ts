import { Router } from "express";
import type { AppContext } from "./context.js";

/**
 * Unauthenticated dashboard state read (LAN-only). Mirrors the feedback cache so the
 * web dashboard's status rail works.
 */
export function stateRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const c = ctx.cache.snapshot();
    res.json({
      status: c.status,
      activePresetId: c.activePresetId,
      health: c.health,
      healthMessage: c.healthMessage,
      lastRefreshedAt: c.lastRefreshedAt,
      busy: ctx.runner.isBusy(),
      quota: ctx.quota.snapshot(),
      undo: c.undoSnapshot
        ? { label: c.undoSnapshot.label, capturedAt: c.undoSnapshot.capturedAt }
        : null,
      apiEnabled: ctx.store.get().service.apiEnabled,
      fillRequest: ctx.fills.pending(),
    });
  });

  return router;
}
