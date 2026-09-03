/**
 * Retiring the broadcasts this app created and nobody used (PRD-16 §5, issue 064).
 *
 * This is not housekeeping. YouTube refuses `liveBroadcasts.insert` once a channel holds too many
 * live or scheduled broadcasts (`limitExceeded` / `userBroadcastsExceedLimit`), so every ghost a
 * cancelled show leaves behind is one step closer to a preparation that fails on the night it
 * matters most. Sweeping is how preparing keeps working.
 *
 * **Only broadcasts this app created are ever candidates**, and the ownership record written in
 * issue 062 is the only thing that says which those are. No field on the API resource tells a
 * broadcast the app made from one a human made in Studio — a stray abandoned in Studio and a
 * scheduled show look alike from here — so the sweep never reasons about the channel's broadcast
 * list at all. It asks YouTube only about ids it already owns, and deletes only from that answer.
 */
import type { youtube_v3 } from "googleapis";
import { describeRetireReason, type PreparedBroadcast } from "../storage/schema.js";
import { AppError } from "../core/errors.js";
import { QUOTA_COST } from "../core/quota.js";
import { mapYouTubeError } from "./client.js";

/**
 * How long after its scheduled start an unused broadcast stops being tonight's show and becomes a
 * leftover. Twelve hours, the same window `pickUpcoming` calls an upcoming broadcast stale: a show
 * that has not started half a day after its slot is not going to, and anything still ahead of it —
 * or running late by an hour — is left entirely alone.
 */
export const RETIRE_GRACE_MS = 12 * 60 * 60 * 1000;

/** Most ids YouTube will answer for in one `list`. */
const ID_PAGE = 50;

/**
 * Lifecycle states that mean the broadcast has been on air, or is on air now. `testing` counts:
 * YouTube only moves a broadcast there once an encoder is feeding it, and deleting a broadcast
 * mid-test takes the show off the channel while the operator is looking at it.
 */
const AIRED_STATES = new Set(["live", "liveStarting", "testing", "testStarting", "complete"]);

/**
 * When the broadcast went to air, or null if it never has.
 *
 * `actualStartTime` is the honest answer and is used whenever YouTube gives one. A completed or
 * live broadcast that does not carry it is still one that aired, and falls back to the scheduled
 * time so the record can be stamped with *something* — the stamp's job is to close the question,
 * not to date it to the second.
 */
export function airedAtOf(b: youtube_v3.Schema$LiveBroadcast): string | null {
  const actual = b.snippet?.actualStartTime;
  if (actual) return actual;
  const state = b.status?.lifeCycleStatus ?? "";
  if (!AIRED_STATES.has(state)) return null;
  return b.snippet?.actualEndTime ?? b.snippet?.scheduledStartTime ?? new Date(0).toISOString();
}

export interface SweepPlan {
  /** App-created, unused, past due — delete these. */
  retire: Array<{ record: PreparedBroadcast; reason: string }>;
  /** Went to air. Never deleted; stamped so they are never asked about again. */
  aired: Array<{ record: PreparedBroadcast; airedAt: string }>;
  /** YouTube no longer has them. Nothing to delete, but the record should stop claiming a link. */
  gone: Array<{ record: PreparedBroadcast; reason: string }>;
}

/**
 * Decides what happens to each ownership record, given what YouTube currently says about it.
 *
 * Pure, and pinned by tests, because this is the function that can delete the wrong thing. Every
 * output entry carries a record from `prepared` — a broadcast with no ownership record cannot
 * reach any of the three lists, whatever the channel shows.
 */
export function planSweep(
  prepared: PreparedBroadcast[],
  remote: youtube_v3.Schema$LiveBroadcast[],
  now: number,
): SweepPlan {
  const byId = new Map(remote.filter((b) => b.id).map((b) => [b.id as string, b]));
  const plan: SweepPlan = { retire: [], aired: [], gone: [] };

  for (const record of prepared) {
    // Already dealt with. Re-deleting would spend a write on nothing, and on a 404 would look
    // like a failure every sweep from now on.
    if (record.retiredAt !== null) continue;
    // Once it has aired it is a recording someone may still be watching, and the stamp is kept
    // rather than re-derived so a later sweep does not have to trust the API twice.
    if (record.airedAt !== null) continue;

    const found = byId.get(record.id);
    if (!found) {
      plan.gone.push({
        record,
        reason: "Deleted from YouTube somewhere other than here — nothing left to remove.",
      });
      continue;
    }

    const aired = airedAtOf(found);
    if (aired !== null) {
      plan.aired.push({ record, airedAt: aired });
      continue;
    }

    // No start time means nothing says its time has passed, so it stays. This is the one case
    // where doing nothing forever is correct: a broadcast we cannot date is a broadcast we
    // cannot call a leftover.
    const scheduled = Date.parse(record.scheduledStartTime ?? "");
    if (Number.isNaN(scheduled)) continue;
    if (now - scheduled < RETIRE_GRACE_MS) continue;

    plan.retire.push({ record, reason: describeRetireReason(record.scheduledStartTime) });
  }

  return plan;
}

export interface SweepOptions {
  /** Milliseconds; injected so the grace window is testable without a clock. */
  now: number;
  /** Persists a changed ownership record. Called once per record the sweep actually touched. */
  onUpdate?: (record: PreparedBroadcast) => Promise<void>;
}

export interface SweepResult {
  retired: PreparedBroadcast[];
  aired: PreparedBroadcast[];
  gone: PreparedBroadcast[];
  /** Deletes YouTube refused. Reported, never thrown: one stubborn ghost must not stop the rest. */
  failed: Array<{ id: string; title: string; message: string }>;
  /** What this sweep cost — one read, plus a write per delete attempted. */
  quotaUnits: number;
}

/** Reads the state of the broadcasts this app owns, then deletes the ones that are leftovers. */
export async function sweepBroadcasts(
  yt: youtube_v3.Youtube,
  prepared: PreparedBroadcast[],
  opts: SweepOptions,
): Promise<SweepResult> {
  const result: SweepResult = { retired: [], aired: [], gone: [], failed: [], quotaUnits: 0 };
  // Nothing owned, nothing to ask about. A sweep on a fresh install must not spend a unit.
  const live = prepared.filter((p) => p.retiredAt === null && p.airedAt === null);
  if (live.length === 0) return result;

  const stamp = new Date(opts.now).toISOString();
  const remote: youtube_v3.Schema$LiveBroadcast[] = [];
  try {
    // Read by id, never by status page: a page of `upcoming` would hand this function broadcasts
    // it has no business holding an opinion about. In pages of fifty because that is the API's
    // cap — a truncated read looks like "YouTube no longer has these", and the ones it dropped
    // would be exactly the ghosts still filling the channel.
    for (let i = 0; i < live.length; i += ID_PAGE) {
      const res = await yt.liveBroadcasts.list({
        part: ["id", "snippet", "status"],
        id: live.slice(i, i + ID_PAGE).map((p) => p.id),
        maxResults: ID_PAGE,
      });
      result.quotaUnits += QUOTA_COST.read;
      remote.push(...(res.data.items ?? []));
    }
  } catch (err) {
    throw mapYouTubeError(err);
  }

  const plan = planSweep(live, remote, opts.now);

  for (const { record, airedAt } of plan.aired) {
    const stamped = { ...record, airedAt };
    await opts.onUpdate?.(stamped);
    result.aired.push(stamped);
  }

  for (const { record, reason } of plan.gone) {
    const stamped = { ...record, retiredAt: stamp, retiredReason: reason };
    await opts.onUpdate?.(stamped);
    result.gone.push(stamped);
  }

  for (const { record, reason } of plan.retire) {
    result.quotaUnits += QUOTA_COST.write;
    try {
      await yt.liveBroadcasts.delete({ id: record.id });
    } catch (err) {
      result.failed.push({ id: record.id, title: record.title, message: mapYouTubeError(err).message });
      continue;
    }
    const stamped = { ...record, retiredAt: stamp, retiredReason: reason };
    await opts.onUpdate?.(stamped);
    result.retired.push(stamped);
  }

  return result;
}

export interface RetireOneOptions {
  now: number;
  /** Why, in the operator's words — recorded on the ownership record and in the activity feed. */
  reason: string;
}

/**
 * Deletes one broadcast this app created, on the operator's press.
 *
 * The caller is responsible for having found `record` in the ownership list; nothing else is ever
 * a legitimate argument here, and the route refuses an id that is not in it.
 */
export async function retireOne(
  yt: youtube_v3.Youtube,
  record: PreparedBroadcast,
  opts: RetireOneOptions,
): Promise<PreparedBroadcast> {
  try {
    await yt.liveBroadcasts.delete({ id: record.id });
  } catch (err) {
    const mapped = mapYouTubeError(err);
    // Already gone is the outcome asked for, not a failure. Reporting an error here would leave
    // the record claiming a broadcast that does not exist, and the operator pressing again.
    if (!isNotFound(err)) throw mapped;
  }
  return { ...record, retiredAt: new Date(opts.now).toISOString(), retiredReason: opts.reason };
}

function isNotFound(err: unknown): boolean {
  if (err instanceof AppError) return err.code === "NO_TARGET_FOUND";
  const e = err as { code?: number | string; status?: number; response?: { status?: number } };
  return Number(e?.response?.status ?? e?.status ?? e?.code) === 404;
}
