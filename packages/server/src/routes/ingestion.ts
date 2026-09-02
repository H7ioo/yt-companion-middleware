import { Router } from "express";
import type { AppContext } from "./context.js";
import { AppError, toErrorBody } from "../core/errors.js";
import { QUOTA_COST } from "../core/quota.js";
import { mapYouTubeError } from "../youtube/client.js";
import { readIngestion } from "../youtube/ingestion.js";
import { toIngestionReadout } from "../core/snapshot.js";

// IngestionReport is part of the shared API contract (the dashboard's ingestion readout).
export type { IngestionReport } from "@app/shared";
import type { IngestionReport } from "@app/shared";

/**
 * "Is video actually arriving?" on demand (PRD-16 §3, issue 059).
 *
 * The poll loop keeps this fresh while a broadcast is live or a latch is armed, and spends
 * nothing the rest of the time — so this route is how the operator gets a current answer at three
 * in the afternoon, an hour before anyone touches OBS. One read, one unit, stated in the response
 * rather than left for the operator to infer from the quota counter moving.
 *
 * The reading is written back into the cache, so a Companion key bound to the ingestion feedback
 * shows what the dashboard just learned without making a call of its own.
 */
export function ingestionRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    // The master switch means "this install spends no quota". Same guard, same reasoning as the
    // broadcast list: the panel hides itself while paused, and this is the half that holds for a
    // stale tab or a direct call.
    if (!ctx.store.get().service.apiEnabled) {
      res.status(409).json(toErrorBody(new AppError("SERVICE_DISABLED")));
      return;
    }
    const streamId = ctx.store.get().defaults.defaultStreamBoundId;
    if (!streamId) {
      // Not an error: an install that has never been told which key OBS pushes to is a normal
      // half-configured install, and the fix is one sentence long.
      res.json(unavailable(
        "No default ingestion key is set, so there is no key to ask YouTube about. Pick the key OBS pushes to in Settings.",
      ));
      return;
    }
    try {
      const snapshot = await readIngestion(ctx.yt, streamId, new Date().toISOString());
      const quotaUnits = QUOTA_COST.read;
      if (!snapshot) {
        // The setting names a key the channel does not have — deleted, or belonging to another
        // channel. The same fact the broadcast list calls a dangling default, said the same way.
        // Any cached reading about *this* key is now known to be about a key that is gone, so it
        // is dropped rather than left to be pushed to the dashboard and Companion as current.
        // A reading about a different key (the bound one the poll loop prefers) is left alone.
        if (ctx.store.get().cache?.ingestion?.streamId === streamId) {
          await ctx.cache.writeCache({ ingestion: null });
        }
        res.json({
          ...unavailable(
            `The default ingestion key (“${streamId}”) is no longer one of this channel's keys — it was deleted, or it belongs to another channel. Pick the key OBS pushes to in Settings.`,
          ),
          quotaUnits,
        });
        return;
      }
      // Cached on the way out so the Companion feedback and the pushed dashboard state carry what
      // this read just learned. Writing it also means an operator's manual check refreshes every
      // surface at once, rather than only the tab they pressed it in.
      await ctx.cache.writeCache({ ingestion: snapshot });
      const body: IngestionReport = {
        readout: toIngestionReadout(snapshot),
        unavailable: null,
        quotaUnits,
      };
      res.json(body);
    } catch (err) {
      res.status(502).json(toErrorBody(mapYouTubeError(err)));
    }
  });

  return router;
}

/** A "nothing to report, and here is why" answer that cost nothing to produce. */
function unavailable(why: string): IngestionReport {
  return { readout: null, unavailable: why, quotaUnits: 0 };
}
