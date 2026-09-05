import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { AppError, toErrorBody } from "../core/errors.js";

const body = z.object({
  /** The broadcast to pin, or null to go back to automatic resolution. */
  id: z.string().min(1).nullable(),
  /** Title as the operator saw it in the list — display only; never used for resolution. */
  label: z.string().nullable().default(null),
});

/**
 * The operator's explicit answer to "which broadcast am I editing".
 *
 * Target resolution otherwise ranks the channel's upcoming broadcasts by how much each looks
 * like the one going to air. That ranking is the best inference available, but a channel
 * carrying strays — the state YouTube Studio leaves behind — gives it candidates only the
 * operator can tell apart. This route lets them say so once instead of hoping.
 *
 * Read-only listing lives on /api/broadcasts (issue 057): the broadcast list carries the evidence
 * the choice turns on, and since issue 072 it is the only control that writes this pin.
 */
export function targetRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(ctx.store.get().targetPin);
  });

  router.put("/", async (req, res) => {
    try {
      const { id, label } = body.parse(req.body);
      const pin = id ? { id, label, pinnedAt: new Date().toISOString() } : null;
      await ctx.store.update((s) => {
        s.targetPin = pin;
        // The pin is about to change which broadcast is targeted, on purpose. Leaving the old id
        // on record would make the very next refresh compare against it and raise TARGET_DRIFT —
        // reporting the operator's own choice as something creating broadcasts behind their back.
        // Drift is a claim about change we did not cause, so forget the id we are deliberately
        // moving away from.
        s.cache.lastTargetId = null;
      });
      ctx.logger.push({
        level: "info",
        category: "action",
        code: null,
        message: pin
          ? `Pinned the edit target to “${label ?? id}”`
          : "Cleared the pinned edit target — back to choosing automatically",
      });
      // A pin changes where the next action lands and can clear a stale PINNED_TARGET_GONE
      // banner, neither of which should wait up to 60s for the background poll.
      void ctx.cache.refresh({ force: true });
      res.json(pin);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res
          .status(400)
          .json(
            toErrorBody(
              new AppError("INVALID_REQUEST", err.issues[0]?.message),
            ),
          );
        return;
      }
      res.status(400).json(toErrorBody(err));
    }
  });

  return router;
}
