import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { AppError, toErrorBody } from "../core/errors.js";
import { listBroadcasts, pickUpcoming } from "../youtube/broadcasts.js";
import { mapYouTubeError } from "../youtube/client.js";

// BroadcastCandidate is part of the shared API contract (the dashboard's target picker).
export type { BroadcastCandidate } from "@app/shared";
import type { BroadcastCandidate } from "@app/shared";

const body = z.object({
  /** The broadcast to pin, or null to go back to automatic resolution. */
  id: z.string().min(1).nullable(),
  /** Title as the operator saw it in the picker — display only; never used for resolution. */
  label: z.string().nullable().default(null),
});

/**
 * The operator's explicit answer to "which broadcast am I editing".
 *
 * Target resolution otherwise ranks the channel's upcoming broadcasts by how much each looks
 * like the one going to air. That ranking is the best inference available, but a channel
 * carrying strays — the state YouTube Studio leaves behind — gives it candidates only the
 * operator can tell apart. This route lets them say so once instead of hoping.
 */
export function targetRouter(ctx: AppContext): Router {
  const router = Router();

  /**
   * The pickable broadcasts, newest-relevant first, each marked with whether it is on air and
   * whether it is the one resolution would choose unaided — so the picker can show what the
   * automatic answer would be rather than making the choice feel arbitrary.
   */
  router.get("/candidates", async (_req, res) => {
    try {
      const now = Date.now();
      // Same page walk as resolveTarget, deliberately: a picker that reads fewer broadcasts than
      // resolution does can omit the very broadcast being edited, and would disagree with the
      // real pick about which one is automatic.
      const [active, upcomingItems] = await Promise.all([
        listBroadcasts(ctx.yt, { broadcastStatus: "active" }),
        listBroadcasts(ctx.yt, { broadcastStatus: "upcoming" }),
      ]);
      const wouldPickId = pickUpcoming(upcomingItems, now)?.chosen.id ?? null;
      const candidates: BroadcastCandidate[] = [
        ...active.map((b) => toCandidate(b, true, false)),
        ...upcomingItems
          .map((b) => toCandidate(b, false, b.id === wouldPickId))
          // Closest to air first, mirroring how the picker itself ranks them, so the operator's
          // eye lands on the same broadcast the app would have chosen. A broadcast with no
          // scheduled start sorts last rather than first — it is the least identifiable row, not
          // the most imminent one.
          .sort(
            (a, b) =>
              Number(b.wouldPick) - Number(a.wouldPick) ||
              startKey(a).localeCompare(startKey(b)),
          ),
      ];
      res.json(candidates);
    } catch (err) {
      res.status(502).json(toErrorBody(mapYouTubeError(err)));
    }
  });

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

/** Sort key for "closest to air": no scheduled start sorts after every real timestamp. */
function startKey(c: BroadcastCandidate): string {
  return c.scheduledStartTime ?? "\uffff";
}

function toCandidate(
  b: { id?: string | null; snippet?: unknown; status?: unknown },
  isLive: boolean,
  wouldPick: boolean,
): BroadcastCandidate {
  const snippet = (b.snippet ?? {}) as {
    title?: string | null;
    scheduledStartTime?: string | null;
  };
  const status = (b.status ?? {}) as { lifeCycleStatus?: string | null };
  return {
    id: b.id!,
    title: snippet.title ?? b.id!,
    scheduledStartTime: snippet.scheduledStartTime ?? null,
    lifeCycleStatus: status.lifeCycleStatus ?? null,
    isLive,
    wouldPick,
  };
}
