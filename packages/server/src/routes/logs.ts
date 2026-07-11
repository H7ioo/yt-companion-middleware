import { Router } from "express";
import type { AppContext } from "./context.js";

/**
 * Activity log read (PRD-06 §3), LAN-trust like the other dashboard routes. Returns the in-memory
 * ring buffer newest-first so the dashboard's Activity panel can render it directly.
 */
export function logsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(ctx.logger.list());
  });

  return router;
}
