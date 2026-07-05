import { Router } from "express";
import type { AppContext } from "./context.js";

/**
 * Feedback endpoints (PRD §5.4). Served entirely from the in-app cache — never a live
 * YouTube call — so Companion polling every 5s costs zero YouTube quota.
 */
export function feedbackRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/active-preset", (_req, res) => {
    res.json({ activePresetId: ctx.cache.snapshot().activePresetId });
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
