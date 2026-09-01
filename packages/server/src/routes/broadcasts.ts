import { Router } from "express";
import type { AppContext } from "./context.js";
import { toErrorBody } from "../core/errors.js";
import { mapYouTubeError } from "../youtube/client.js";
import { listBroadcasts } from "../youtube/broadcasts.js";
import { listWhatWillAir } from "../youtube/willAir.js";
import { toStreamInfo } from "./streams.js";

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
    // Measured rather than asserted: the tracker meters every YouTube call the client makes, so
    // the difference across the fetch is what this listing actually cost. Typically 3 units —
    // one page of active, one page of upcoming, one stream read — rising by one per extra page
    // on a channel carrying strays.
    const before = ctx.quota.snapshot().used;
    try {
      const [active, upcoming, streams] = await Promise.all([
        listBroadcasts(ctx.yt, { broadcastStatus: "active" }),
        // The same page walk resolution does, deliberately: a list that reads fewer broadcasts
        // than resolution does can omit the very broadcast about to air — which is the bug this
        // whole feature exists to make visible.
        listBroadcasts(ctx.yt, { broadcastStatus: "upcoming" }),
        ctx.yt.liveStreams
          .list({ part: ["snippet", "cdn"], mine: true })
          .then((r) => (r.data.items ?? []).map(toStreamInfo)),
      ]);

      const listing = listWhatWillAir({
        active,
        upcoming,
        streams,
        defaultStreamBoundId: ctx.store.get().defaults.defaultStreamBoundId,
        now: Date.now(),
      });
      res.json({
        ...listing,
        quotaUnits: ctx.quota.snapshot().used - before,
      });
    } catch (err) {
      res.status(502).json(toErrorBody(mapYouTubeError(err)));
    }
  });

  return router;
}
