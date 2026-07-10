import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { AppError, toErrorBody } from "../core/errors.js";

// Empty string clears the webhook; otherwise it must be a valid URL.
const body = z.object({
  url: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.string().url().nullable()),
});

/** Outbound state-change webhook config (PRD feature: push on state change). */
export function webhookRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(ctx.store.get().webhook);
  });

  router.put("/", async (req, res) => {
    try {
      const { url } = body.parse(req.body);
      await ctx.store.update((s) => {
        s.webhook = { url };
      });
      res.json(ctx.store.get().webhook);
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
