import { Router } from "express";
import type { youtube_v3 } from "googleapis";
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
      const streams: StreamInfo[] = (await listStreams(ctx.yt)).sort((a, b) =>
        a.title.localeCompare(b.title),
      );
      cached = { at: Date.now(), streams };
      res.json(streams);
    } catch (err) {
      res.status(502).json(toErrorBody(mapYouTubeError(err)));
    }
  });

  return router;
}

/**
 * YouTube's default page size for liveStreams.list is 5, the same default that used to hide the
 * broadcast going to air. A channel with more keys than that had the rest silently dropped: the
 * broadcast list then printed a truncated key count as fact and named the missing keys by raw id.
 * 50 is the API maximum; 4 pages is the same ceiling the broadcast walk uses.
 */
const PAGE_SIZE = 50;
const MAX_PAGES = 4;

/**
 * Every ingestion key on the channel, walked past page 1. `onPage` is called once per API call
 * so a caller can report what the read actually cost instead of inferring it from a global
 * counter that other work also moves.
 *
 * Errors are left raw for the caller to map — both call sites already do.
 */
export async function listStreams(
  yt: youtube_v3.Youtube,
  onPage?: () => void,
): Promise<StreamInfo[]> {
  const items: StreamInfo[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await yt.liveStreams.list({
      part: ["snippet", "cdn"],
      mine: true,
      maxResults: PAGE_SIZE,
      ...(pageToken ? { pageToken } : {}),
    });
    onPage?.();
    items.push(...(res.data.items ?? []).map(toStreamInfo));
    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }
  return items;
}

/**
 * The contract shape of one ingestion key. Exported because the broadcast list (issue 057) names
 * the key a broadcast is attached to, and two copies of this mapping would eventually disagree
 * about what a stream with no title is called.
 */
export function toStreamInfo(item: {
  id?: string | null;
  snippet?: { title?: string | null } | null;
  cdn?: { ingestionInfo?: { streamName?: string | null } | null } | null;
}): StreamInfo {
  return {
    id: item.id!,
    title: item.snippet?.title ?? item.id!,
    streamName: item.cdn?.ingestionInfo?.streamName ?? null,
  };
}
