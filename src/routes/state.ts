import { Router } from "express";
import type { AppContext } from "./context.js";

/**
 * Unauthenticated dashboard state read (LAN-trust). Mirrors the feedback cache so the
 * web dashboard's status rail works without holding the Companion Bearer token.
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
    });
  });

  return router;
}
