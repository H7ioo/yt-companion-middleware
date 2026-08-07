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
 * How close to air a freshly-created upcoming broadcast has to be before we read it as one
 * YouTube minted for an auto-start encoder session rather than one a human made in Studio.
 * PRD-12 documents the mint as landing about a minute before air; five minutes covers clock
 * skew and a slow refresh without swallowing a broadcast scheduled for later tonight.
 */
const AUTO_START_MINT_MS = 5 * 60 * 1000;

/**
 * An upcoming broadcast whose scheduled start is older than this is a leftover, not the next
 * show. YouTube never garbage-collects an event you created and abandoned, so a channel
 * accumulates them — and a stale one used to win target selection outright, because the old
 * tiebreak was "earliest scheduled start". Twelve hours is deliberately generous: a broadcast
 * YouTube mints for an auto-start encoder session is scheduled at roughly *now*, and a
 * legitimately-scheduled show is in the future, so neither is ever caught by this.
 */
const STALE_UPCOMING_MS = 12 * 60 * 60 * 1000;

/**
 * Something about the channel's broadcast list means the target we picked may not be the one
 * that actually goes to air. We cannot detect "YouTube Studio is open" — there is no API for
 * it — but these are the states it leaves behind, and each one is a concrete thing the
 * operator can act on.
 */
export interface TargetConflict {
  code: "SHARED_STREAM_KEY" | "MULTIPLE_UPCOMING" | "TARGET_DRIFT";
  message: string;
  /** The broadcast ids involved, so the dashboard can name them. */
  ids: string[];
}

export interface TargetResolution extends TargetInfo {
  /** Non-null when the pick is ambiguous — surfaced to the operator, never thrown. */
  conflict: TargetConflict | null;
  /**
   * The pick is an upcoming broadcast that was created moments ago and is scheduled to start
   * about now — the shape of an auto-start mint. Callers use it to tell "YouTube is about to
   * start the show" apart from "someone is creating broadcasts behind my back".
   */
  autoStartMint: boolean;
}

/** True when `b` looks like the broadcast YouTube mints as an auto-start session begins. */
export function isAutoStartMint(b: youtube_v3.Schema$LiveBroadcast, now: number): boolean {
  const scheduled = Date.parse(b.snippet?.scheduledStartTime ?? "");
  if (Number.isNaN(scheduled) || Math.abs(scheduled - now) > AUTO_START_MINT_MS) return false;
  const created = Date.parse(b.snippet?.publishedAt ?? "");
  // No creation time: the "starting about now" half is the signal we have, and it is the half
  // that matters — a leftover from last week never matches it.
  return Number.isNaN(created) || now - created <= AUTO_START_MINT_MS;
}

/**
 * Chooses among upcoming broadcasts and reports why the choice might be wrong.
 *
 * Exported for tests: the ordering rules here are the whole reason a pre-live title used to
 * land on the wrong broadcast, so they are pinned directly rather than through resolveTarget.
 */
export function pickUpcoming(
  upcoming: youtube_v3.Schema$LiveBroadcast[],
  now: number,
): { chosen: youtube_v3.Schema$LiveBroadcast; conflict: TargetConflict | null } | null {
  if (upcoming.length === 0) return null;

  // Drop the leftovers first. If *every* candidate is stale they are all we have, so fall back
  // to the full list rather than reporting no target at all.
  const fresh = upcoming.filter((b) => {
    const scheduled = Date.parse(b.snippet?.scheduledStartTime ?? "");
    return Number.isNaN(scheduled) || scheduled > now - STALE_UPCOMING_MS;
  });
  const candidates = fresh.length > 0 ? fresh : upcoming;

  // Closest to air first: encoder-bound over a stub, then still-to-start over past-due, then
  // soonest scheduled, then most recently created. The past-due rank matters because the
  // staleness filter above only drops leftovers older than 12h — a stray scheduled earlier
  // *today* would otherwise win outright over the broadcast YouTube mints at air time. The
  // create-time tiebreak matters because that mint lands moments before going live, so when
  // scheduled times tie, newest is the real one.
  const sorted = [...candidates].sort(
    (a, b) =>
      readinessRank(b) - readinessRank(a) ||
      pastDueRank(a, now) - pastDueRank(b, now) ||
      scheduledCompare(a, b, now) ||
      createTimeMs(b) - createTimeMs(a),
  );

  return { chosen: sorted[0], conflict: conflictAmong(candidates, sorted[0]) };
}

/**
 * Two upcoming broadcasts bound to the same stream key is the decisive case: the encoder can
 * only feed one of them, so exactly one goes to air and the other silently keeps whatever we
 * wrote to it. Plain "more than one upcoming" is weaker but still worth saying out loud.
 */
function conflictAmong(
  candidates: youtube_v3.Schema$LiveBroadcast[],
  chosen: youtube_v3.Schema$LiveBroadcast,
): TargetConflict | null {
  if (candidates.length < 2) return null;

  const boundId = chosen.contentDetails?.boundStreamId;
  if (boundId) {
    const sharing = candidates.filter((b) => b.contentDetails?.boundStreamId === boundId);
    if (sharing.length > 1) {
      return {
        code: "SHARED_STREAM_KEY",
        message: `${sharing.length} upcoming broadcasts are bound to the same stream key — only one will go to air, and edits may land on the other. Delete the ones you are not using.`,
        ids: sharing.map((b) => b.id!).filter(Boolean),
      };
    }
  }

  return {
    code: "MULTIPLE_UPCOMING",
    message: `${candidates.length} upcoming broadcasts exist — edits target “${chosen.snippet?.title ?? chosen.id}”, which may not be the one you start. Delete the strays to be sure.`,
    ids: candidates.map((b) => b.id!).filter(Boolean),
  };
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
export async function resolveTarget(
  yt: youtube_v3.Youtube,
  now: number = Date.now(),
): Promise<TargetResolution> {
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
    // Live is unambiguous by comparison — the encoder feeds exactly one broadcast, so there is
    // nothing for the operator to disambiguate even when a stale upcoming still exists.
    return { id: active[0].id!, isLive: true, conflict: null, autoStartMint: false };
  }

  // Scheduled but not yet live. Prefer the broadcast closest to going live — one that is
  // "ready"/"testing" (bound to an encoder) over a freshly "created" stub — then the one
  // starting soonest, ignoring leftovers scheduled long in the past.
  const upcoming = await listBroadcasts(yt, { broadcastStatus: "upcoming" });
  const picked = pickUpcoming(upcoming, now);
  if (picked) {
    if (picked.conflict) {
      warnOnce(
        `${picked.conflict.code}:${picked.chosen.id}`,
        `[broadcasts] ${picked.conflict.message} (selected ${picked.chosen.id}, life=${picked.chosen.status?.lifeCycleStatus})`,
      );
    }
    return {
      id: picked.chosen.id!,
      isLive: false,
      conflict: picked.conflict,
      autoStartMint: isAutoStartMint(picked.chosen, now),
    };
  }

  // Legacy only: YouTube stopped auto-creating persistent "default" broadcasts on 2020-09-01,
  // so this branch is empty on any channel enabled for live since then. Kept for the older
  // channels that still have one.
  const persistent = await listBroadcasts(yt, { broadcastType: "persistent", mine: true });
  if (persistent.length > 0) {
    // Prefer the most recently created persistent container if several exist.
    persistent.sort((a, b) => createTimeMs(b) - createTimeMs(a));
    return { id: persistent[0].id!, isLive: false, conflict: null, autoStartMint: false };
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
/**
 * 0 = still to start (or no scheduled time), 1 = its scheduled start has already passed. The
 * grace window is the auto-start mint window: a broadcast YouTube minted for a session starting
 * "now" drifts a few seconds into the past immediately, and must not be demoted below a stray
 * scheduled for tonight.
 */
function pastDueRank(b: youtube_v3.Schema$LiveBroadcast, now: number): number {
  return scheduledStartMs(b) < now - AUTO_START_MINT_MS ? 1 : 0;
}
/**
 * Soonest first among broadcasts still to start; most recent first among past-due ones, where
 * "just missed its slot" is far more likely to be the show than "was due this morning".
 */
function scheduledCompare(
  a: youtube_v3.Schema$LiveBroadcast,
  b: youtube_v3.Schema$LiveBroadcast,
  now: number,
): number {
  const [as, bs] = [scheduledStartMs(a), scheduledStartMs(b)];
  return pastDueRank(a, now) === 1 ? bs - as : as - bs;
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
