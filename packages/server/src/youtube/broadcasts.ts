import type { youtube_v3 } from "googleapis";
import { AppError } from "../core/errors.js";
import { mapYouTubeError } from "./client.js";
import type { BroadcastResource, ResolvedPlan } from "../core/resolve.js";

const BROADCAST_PARTS = ["id", "snippet", "status", "contentDetails"];

// Dedupe noisy warnings across the 60s refresh loop — only log when the situation changes.
let lastWarnKey: string | null = null;
function warnOnce(key: string, message: string): void {
  if (key === lastWarnKey) return;
  lastWarnKey = key;
  console.warn(message);
}

export interface TargetInfo {
  id: string;
  isLive: boolean;
}

/**
 * Resolves the metadata target (PRD §2, §6):
 *   State B (Live):  the currently active broadcast.
 *   State A (Idle):  a scheduled (upcoming) broadcast, or the channel's persistent
 *                    broadcast container — whichever exists.
 * Throws NO_TARGET_FOUND if none exist.
 *
 * `broadcastStatus: active` covers a broadcast that is currently streaming. A channel
 * that has scheduled a stream but not gone live yet only shows up under `upcoming`, and
 * the legacy "default stream" only shows up under `broadcastType: persistent` — so we
 * fall through all three before giving up.
 */
export async function resolveTarget(yt: youtube_v3.Youtube): Promise<TargetInfo> {
  // Note: broadcastStatus and mine are mutually exclusive (API returns 400). Status
  // queries are already scoped to the authenticated channel, so mine is not needed.
  const active = await listBroadcasts(yt, { broadcastStatus: "active" });
  if (active.length > 0) {
    if (active.length > 1) {
      // Multiple active broadcasts (missed transition / simulcast). Pick the most
      // recently started and warn (PRD §6).
      active.sort((a, b) => startTimeMs(b) - startTimeMs(a));
      console.warn(
        `[broadcasts] ${active.length} active broadcasts found; selecting most recent actualStartTime (${active[0].id}).`,
      );
    }
    return { id: active[0].id!, isLive: true };
  }

  // Scheduled but not yet live. Prefer the broadcast closest to going live — one that is
  // "ready"/"testing" (bound to an encoder) over a freshly "created" stub — then the one
  // starting soonest.
  const upcoming = await listBroadcasts(yt, { broadcastStatus: "upcoming" });
  if (upcoming.length > 0) {
    upcoming.sort(
      (a, b) => readinessRank(b) - readinessRank(a) || scheduledStartMs(a) - scheduledStartMs(b),
    );
    if (upcoming.length > 1) {
      warnOnce(
        `upcoming:${upcoming[0].id}`,
        `[broadcasts] ${upcoming.length} upcoming broadcasts found; selecting ${upcoming[0].id} (life=${upcoming[0].status?.lifeCycleStatus}). Delete stray broadcasts or the pick may not be the one you expect.`,
      );
    }
    return { id: upcoming[0].id!, isLive: false };
  }

  const persistent = await listBroadcasts(yt, { broadcastType: "persistent", mine: true });
  if (persistent.length > 0) {
    // Prefer the most recently created persistent container if several exist.
    persistent.sort((a, b) => createTimeMs(b) - createTimeMs(a));
    return { id: persistent[0].id!, isLive: false };
  }

  throw new AppError("NO_TARGET_FOUND");
}

async function listBroadcasts(
  yt: youtube_v3.Youtube,
  params: youtube_v3.Params$Resource$Livebroadcasts$List,
): Promise<youtube_v3.Schema$LiveBroadcast[]> {
  try {
    const res = await yt.liveBroadcasts.list({ part: BROADCAST_PARTS, ...params });
    return res.data.items ?? [];
  } catch (err) {
    throw mapYouTubeError(err);
  }
}

/** Raw GET of a single broadcast by id. */
export async function getBroadcast(
  yt: youtube_v3.Youtube,
  id: string,
): Promise<youtube_v3.Schema$LiveBroadcast> {
  try {
    const res = await yt.liveBroadcasts.list({ part: BROADCAST_PARTS, id: [id] });
    const item = res.data.items?.[0];
    if (!item) throw new AppError("NO_TARGET_FOUND", `Broadcast ${id} not found`);
    return item;
  } catch (err) {
    throw mapYouTubeError(err);
  }
}

/**
 * Applies a resolved plan (PRD §3.3, §6):
 *   1. liveBroadcasts.update — full merged broadcast (title/description/privacy + passthrough).
 *   2. videos.update — snippet.categoryId, if a category was resolved.
 *   3. liveBroadcasts.bind — bind the stream, if a streamBoundId was resolved.
 */
export async function applyPlan(yt: youtube_v3.Youtube, plan: ResolvedPlan): Promise<void> {
  const broadcastId = plan.broadcast.id;
  if (!broadcastId) throw new AppError("NO_TARGET_FOUND", "Resolved broadcast has no id");

  try {
    await yt.liveBroadcasts.update({
      part: BROADCAST_PARTS,
      requestBody: plan.broadcast as youtube_v3.Schema$LiveBroadcast,
    });
  } catch (err) {
    throw mapYouTubeError(err);
  }

  if (plan.categoryId !== null) {
    await updateVideoCategory(yt, broadcastId, plan.categoryId);
  }

  if (plan.streamBoundId !== null) {
    await bindStream(yt, broadcastId, plan.streamBoundId);
  }
}

/**
 * Category lives on the video resource, not the broadcast. A read-modify-write on the
 * video snippet keeps title/description consistent and preserves other snippet fields.
 */
async function updateVideoCategory(
  yt: youtube_v3.Youtube,
  videoId: string,
  categoryId: string,
): Promise<void> {
  try {
    const res = await yt.videos.list({ part: ["snippet"], id: [videoId] });
    const snippet = res.data.items?.[0]?.snippet;
    if (!snippet) throw new AppError("NO_TARGET_FOUND", `Video ${videoId} not found`);
    snippet.categoryId = categoryId;
    await yt.videos.update({ part: ["snippet"], requestBody: { id: videoId, snippet } });
  } catch (err) {
    throw mapYouTubeError(err);
  }
}

async function bindStream(
  yt: youtube_v3.Youtube,
  broadcastId: string,
  streamId: string,
): Promise<void> {
  try {
    await yt.liveBroadcasts.bind({
      id: broadcastId,
      part: BROADCAST_PARTS,
      streamId,
    });
  } catch (err) {
    throw mapYouTubeError(err);
  }
}

function startTimeMs(b: youtube_v3.Schema$LiveBroadcast): number {
  return Date.parse(b.snippet?.actualStartTime ?? "") || 0;
}
function scheduledStartMs(b: youtube_v3.Schema$LiveBroadcast): number {
  return Date.parse(b.snippet?.scheduledStartTime ?? "") || Number.MAX_SAFE_INTEGER;
}
/** Higher = closer to going live. Prefers an encoder-bound broadcast over a stub. */
function readinessRank(b: youtube_v3.Schema$LiveBroadcast): number {
  switch (b.status?.lifeCycleStatus) {
    case "testing":
      return 3;
    case "ready":
      return 2;
    case "created":
      return 1;
    default:
      return 0;
  }
}
function createTimeMs(b: youtube_v3.Schema$LiveBroadcast): number {
  return Date.parse(b.snippet?.publishedAt ?? "") || 0;
}

/** Reads the fields the status cache cares about from a broadcast resource. */
export function toStatus(b: BroadcastResource | youtube_v3.Schema$LiveBroadcast) {
  const lifeCycle = (b.status as { lifeCycleStatus?: string } | null | undefined)?.lifeCycleStatus;
  return {
    title: (b.snippet?.title as string | undefined) ?? null,
    privacyStatus: (b.status?.privacyStatus as string | undefined) ?? null,
    isLive: lifeCycle === "live" || lifeCycle === "liveStarting",
  };
}
