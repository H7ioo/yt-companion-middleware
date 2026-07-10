import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { AppError, toErrorBody } from "../core/errors.js";

const body = z.object({ apiEnabled: z.boolean() });

/**
 * Master API switch (dashboard kill-switch). When off, the middleware makes no YouTube calls
 * at all — the background poll idles and every action is rejected — so an idle service (with
 * Companion still polling) stops burning quota. Flip it back on to resume.
 */
export function serviceRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(ctx.store.get().service);
  });

  router.put("/", async (req, res) => {
    try {
      const { apiEnabled } = body.parse(req.body);
      const was = ctx.store.get().service.apiEnabled;
      await ctx.store.update((s) => {
        s.service = { apiEnabled };
      });
      // Push the switch to the dashboard/SSE/webhook immediately.
      ctx.events.emitChange();
      // Turning the API back on: warm the cache right away so status isn't stale.
      if (apiEnabled && !was) void ctx.cache.refresh();
      res.json(ctx.store.get().service);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json(toErrorBody(new AppError("INVALID_REQUEST", err.issues[0]?.message)));
        return;
      }
      res.status(400).json(toErrorBody(err));
    }
  });

  return router;
}
