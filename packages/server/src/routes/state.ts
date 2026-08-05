import { Router } from "express";
import type { AppContext } from "./context.js";
import { buildDashboardState } from "../core/snapshot.js";

/**
 * Unauthenticated dashboard state read (LAN-only) — the dashboard's first paint.
 *
 * Built by `buildDashboardState`, the same assembler the SSE stream, the webhook and
 * /action/refresh use. This route used to hand-roll an equivalent object, which meant every
 * field added to the contract was missing on first paint until the next push happened to arrive
 * — the drift PRD-10 §1 called out on the refresh route, still living here.
 */
export function stateRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(buildDashboardState(ctx.store, ctx.cache, ctx.runner, ctx.quota, ctx.fills));
  });

  return router;
}
