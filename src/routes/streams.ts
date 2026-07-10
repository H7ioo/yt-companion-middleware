import { Router } from "express";
import type { AppContext } from "./context.js";
import { mapYouTubeError } from "../youtube/client.js";
import { toErrorBody } from "../core/errors.js";

// StreamInfo is part of the shared API contract (the preset form's stream picker).
export type { StreamInfo } from "@app/shared";
import type { StreamInfo } from "@app/shared";

// Short-lived cache: the stream list rarely changes, but it can (new key created), so keep
// it brief rather than for the process lifetime. liveStreams.list costs 1 quota unit.
const TTL_MS = 30_000;
let cached: { at: number; streams: StreamInfo[] } | null = null;

/**
 * The channel's live streams (ingestion keys), used to validate a preset's stream binding
 * against reality so a stale/deleted key can be flagged before it silently fails a trigger
 * (PRD feature: preset validation). Dashboard-only, served unauthenticated.
 */
export function streamsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    if (cached && Date.now() - cached.at < TTL_MS) {
      res.json(cached.streams);
      return;
    }
    try {
      const resp = await ctx.yt.liveStreams.list({ part: ["snippet", "cdn"], mine: true });
      const streams: StreamInfo[] = (resp.data.items ?? [])
        .map((item) => ({
          id: item.id!,
          title: item.snippet?.title ?? item.id!,
          streamName: item.cdn?.ingestionInfo?.streamName ?? null,
        }))
        .sort((a, b) => a.title.localeCompare(b.title));
      cached = { at: Date.now(), streams };
      res.json(streams);
    } catch (err) {
      res.status(502).json(toErrorBody(mapYouTubeError(err)));
    }
  });

  return router;
}
