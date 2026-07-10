import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { AppError, toErrorBody } from "../core/errors.js";
import { privacyStatusSchema } from "../storage/schema.js";
import type { MetadataPayload } from "../core/resolve.js";

const presetBody = z.object({
  presetId: z.string().min(1),
  // Optional fill-in values for `{name}` template variables (PRD §4).
  vars: z.record(z.string()).optional(),
});

const updateBody = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  privacyStatus: privacyStatusSchema.optional(),
  category: z.string().min(1).nullable().optional(),
  streamBoundId: z.string().min(1).nullable().optional(),
});

// `status` sets an explicit privacy; omit it (or pass mode:"toggle") to flip private<->public.
const privacyBody = z.object({
  status: privacyStatusSchema.optional(),
  mode: z.literal("toggle").optional(),
});

/**
 * Action endpoints (PRD §5.3). All ALWAYS return HTTP 200 with success/error in the body
 * (PRD §7), so Companion's HTTP module never has to branch on status codes.
 */
export function actionRouter(ctx: AppContext): Router {
  const router = Router();

  router.post("/preset", async (req, res) => {
    try {
      const { presetId, vars } = presetBody.parse(req.body);
      const result = await ctx.runner.runPreset(presetId, vars);
      res.json({ success: true, ...result });
    } catch (err) {
      res.json(handle(err));
    }
  });

  router.post("/update", async (req, res) => {
    try {
      const parsed = updateBody.parse(req.body);
      const payload: MetadataPayload = parsed;
      const result = await ctx.runner.runUpdate(payload);
      res.json({ success: true, ...result });
    } catch (err) {
      res.json(handle(err));
    }
  });

  router.post("/privacy", async (req, res) => {
    try {
      const { status } = privacyBody.parse(req.body);
      const result = await ctx.runner.runPrivacy({ status });
      res.json({ success: true, ...result });
    } catch (err) {
      res.json(handle(err));
    }
  });

  router.post("/undo", async (_req, res) => {
    try {
      const result = await ctx.runner.runUndo();
      res.json({ success: true, ...result });
    } catch (err) {
      res.json(handle(err));
    }
  });

  router.post("/refresh", async (_req, res) => {
    try {
      if (!ctx.store.get().service.apiEnabled) throw new AppError("SERVICE_DISABLED");
      await ctx.cache.refresh();
      res.json({ success: true, ...ctx.cache.snapshot() });
    } catch (err) {
      res.json(handle(err));
    }
  });

  return router;
}

function handle(err: unknown) {
  if (err instanceof z.ZodError) {
    return toErrorBody(new AppError("INVALID_REQUEST", err.issues[0]?.message));
  }
  return toErrorBody(err);
}
