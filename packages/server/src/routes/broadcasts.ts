import { Router } from "express";
import type { AppContext } from "./context.js";
import { AppError, toErrorBody } from "../core/errors.js";
import { QUOTA_COST } from "../core/quota.js";
import { mapYouTubeError } from "../youtube/client.js";
import { listBroadcasts } from "../youtube/broadcasts.js";
import { listWhatWillAir } from "../youtube/willAir.js";
import { listStreams } from "./streams.js";

// BroadcastListing is part of the shared API contract (the dashboard's broadcast list).
export type { BroadcastListing } from "@app/shared";

/**
 * "Which broadcast will actually air?" — the read-only answer that ends a Studio trip (PRD-16 §1,
 * issue 057).
 *
 * Read-only and on demand: nothing here polls. A list refreshed on an interval costs more quota
 * than the single target the background loop already tracks, so the operator asks for it.
 */
export function broadcastsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    // The API master switch means "this install spends no quota", and three live reads on a
    // paused install would break that promise. The dashboard already hides the panel while
    // paused; this is the half that holds for a stale tab or a direct call.
    if (!ctx.store.get().service.apiEnabled) {
      res.status(409).json(toErrorBody(new AppError("SERVICE_DISABLED")));
      return;
    }
    // Counted from this request's own calls rather than from a delta of the process-wide quota
    // counter: the background poll runs concurrently, so a delta charges its calls to this
    // listing (and reads negative across the Pacific-midnight reset). Typically 3 — one page of
    // active, one page of upcoming, one stream read — rising by one per extra page.
    let calls = 0;
    const count = () => {
      calls += 1;
    };
    try {
      const [active, upcoming, streams] = await Promise.all([
        listBroadcasts(ctx.yt, { broadcastStatus: "active" }, count),
        // The same page walk resolution does, deliberately: a list that reads fewer broadcasts
        // than resolution does can omit the very broadcast about to air — which is the bug this
        // whole feature exists to make visible.
        listBroadcasts(ctx.yt, { broadcastStatus: "upcoming" }, count),
        // Walked too: a truncated key list would print a wrong key count as fact in the verdict
        // and leave the keys past page 1 named by raw id.
        listStreams(ctx.yt, count),
      ]);

      const listing = listWhatWillAir({
        active,
        upcoming,
        streams,
        defaultStreamBoundId: ctx.store.get().defaults.defaultStreamBoundId,
      });
      res.json({ ...listing, quotaUnits: calls * QUOTA_COST.read });
    } catch (err) {
      res.status(502).json(toErrorBody(mapYouTubeError(err)));
    }
  });

  return router;
}
