import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { defaultSettingsSchema } from "../storage/schema.js";
import { AppError, toErrorBody } from "../core/errors.js";

const body = z.object({
  defaultCategory: z.string().min(1).nullable().default(null),
  defaultStreamBoundId: z.string().min(1).nullable().default(null),
});

/** App-level default settings (PRD §3.1, §8.2). */
export function settingsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(ctx.store.get().defaults);
  });

  router.put("/", async (req, res) => {
    try {
      const defaults = defaultSettingsSchema.parse(body.parse(req.body));
      await ctx.store.update((s) => {
        s.defaults = defaults;
      });
      res.json(defaults);
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
