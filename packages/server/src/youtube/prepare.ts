/**
 * Preparing a broadcast ahead of time (PRD-16 §2, issue 062).
 *
 * The operator's actual ask: make tonight's broadcast now, get its link out to the audience, and
 * have the title right on the *first* frame instead of corrected a few seconds after air. That is
 * three YouTube calls in a fixed order, and every one of them is a decision:
 *
 *   1. `liveBroadcasts.insert` — with the metadata in the insert body. Not inserted blank and
 *      patched afterwards: a patch is a second write that can fail on its own, and the window
 *      between the two is exactly the window where a placeholder title is what the audience sees.
 *   2. `liveBroadcasts.bind` — to the **existing** reusable key, the one OBS already holds.
 *      Creating a stream here would mean re-pasting a key into OBS before every show, which is
 *      the chore this whole feature exists to remove. Nothing in this module creates a stream.
 *   3. `videos.update` — category only, and only when one was resolved. Category is not a field
 *      on the broadcast resource, so it cannot ride along in step 1.
 *
 * Cost: 50 units for the insert and 50 for the bind — ~100 per preparation against the 10,000/day
 * budget, plus 50 more when a category is set.
 */
import type { youtube_v3 } from "googleapis";
import type { PreparedBroadcast, PrivacyStatus } from "../storage/schema.js";
import { AppError } from "../core/errors.js";
import { mapYouTubeError } from "./client.js";

/** Everything the insert needs, already resolved — presets, defaults and templates are the caller's job. */
export interface PrepareInput {
  title: string;
  description: string;
  privacyStatus: PrivacyStatus;
  /** ISO-8601. YouTube requires a scheduled start on every inserted broadcast. */
  scheduledStartTime: string;
  /** The existing key to bind. Required: an unbound broadcast is not a prepared one. */
  streamId: string;
  /** Resolved category, or null to leave YouTube's default alone. */
  categoryId: string | null;
  /** The preset this came from, recorded for the operator's benefit. Null for an ad-hoc payload. */
  presetId: string | null;
}

export interface PrepareOptions {
  /** ISO timestamp for the ownership record; injected so tests are not clock-dependent. */
  now: string;
  /**
   * Upserts the ownership record by id. Called the moment the broadcast exists on YouTube —
   * **before** the bind — and again once the bind has actually landed.
   *
   * The ownership record is the only thing that ever makes a broadcast a cleanup candidate
   * (issue 064) — no API field distinguishes one this app made from one a human made in Studio.
   * A bind that fails after a successful insert would otherwise leave a broadcast on the channel
   * that nothing may ever delete, and those accumulate until `insert` itself starts failing with
   * `limitExceeded` on the night it matters most. It is written with `streamId: null` because at
   * that point no key is bound, and the schema means that field literally.
   */
  onRecord?: (record: PreparedBroadcast) => Promise<void>;
}

/**
 * The broadcast, plus whatever did not land after it already existed.
 *
 * A bind or category write that fails is *not* an error the caller may throw away: the broadcast
 * is on the channel with a public link, and an operator told only "it failed" presses again and
 * puts a second one there. So the id and the watch URL always come back, and the part that did
 * not happen is said in words next to them.
 */
export interface PrepareResult {
  broadcast: PreparedBroadcast;
  /** What still needs doing by hand, or null when the whole preparation landed. */
  warning: string | null;
}

/** The public link, ready to copy the moment the broadcast exists. */
export function watchUrlFor(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * The insert body. Split out from the call so the one thing that matters here — that the
 * operator's own metadata is *in* the creating request — is assertable without a fake client.
 */
export function buildInsertBody(input: PrepareInput): youtube_v3.Schema$LiveBroadcast {
  return {
    snippet: {
      title: input.title,
      description: input.description,
      scheduledStartTime: input.scheduledStartTime,
    },
    status: {
      privacyStatus: input.privacyStatus,
      // YouTube rejects an insert that does not declare this. False is the honest answer for a
      // church/venue stream and the only one this app has ever needed; it is stated rather than
      // left to a default so the refusal cannot appear on the operator's first press.
      selfDeclaredMadeForKids: false,
    },
    contentDetails: {
      // The pair that makes the encoder the only thing the operator has to start. Set at insert
      // because PRD-13's whole finding was that a broadcast without them waits for a human press
      // in Studio, which is the trip this feature removes.
      enableAutoStart: true,
      enableAutoStop: true,
    },
  };
}

/** Inserts the broadcast, binds it to the existing key, and sets the category if there is one. */
export async function prepareBroadcast(
  yt: youtube_v3.Youtube,
  input: PrepareInput,
  opts: PrepareOptions,
): Promise<PrepareResult> {
  let created: youtube_v3.Schema$LiveBroadcast;
  try {
    const res = await yt.liveBroadcasts.insert({
      part: ["snippet", "status", "contentDetails"],
      requestBody: buildInsertBody(input),
    });
    created = res.data;
  } catch (err) {
    // mapYouTubeError names the eligibility refusals before the 403 family, so an ineligible
    // channel arrives at the caller as LIVE_NOT_ELIGIBLE — riding mode — and not as a login
    // problem no reconnect can fix (issue 061).
    throw mapYouTubeError(err);
  }

  const id = created.id;
  if (!id) {
    throw new AppError(
      "YOUTUBE_ERROR",
      "YouTube accepted the broadcast but returned no id, so there is nothing to bind or share.",
    );
  }

  const record: PreparedBroadcast = {
    id,
    title: input.title,
    privacyStatus: input.privacyStatus,
    scheduledStartTime: input.scheduledStartTime,
    // Null until the bind lands: the field says which key is bound, and claiming one that is not
    // would make an unfeedable broadcast look ready in every list that reads this record.
    streamId: null,
    watchUrl: watchUrlFor(id),
    createdAt: opts.now,
    presetId: input.presetId,
  };
  await opts.onRecord?.(record);

  try {
    await yt.liveBroadcasts.bind({
      part: ["id", "contentDetails", "status"],
      id,
      streamId: input.streamId,
    });
  } catch (err) {
    return {
      broadcast: record,
      warning:
        `The broadcast exists, but the ingestion key could not be bound to it ` +
        `(${mapYouTubeError(err).message}). Bind it in YouTube Studio, or delete it and try ` +
        `again — do not press create a second time, that makes a duplicate.`,
    };
  }

  const bound: PreparedBroadcast = { ...record, streamId: input.streamId };
  await opts.onRecord?.(bound);

  if (input.categoryId !== null) {
    try {
      await setVideoCategory(yt, id, input.categoryId);
    } catch (err) {
      return {
        broadcast: bound,
        warning:
          `The broadcast is created and bound, but its category could not be set ` +
          `(${mapYouTubeError(err).message}). Set it in YouTube Studio — everything else is ready.`,
      };
    }
  }

  return { broadcast: bound, warning: null };
}

/**
 * Category lives on the video resource. Read-modify-write on the snippet, the same shape the
 * apply path uses: `videos.update` deletes any snippet field the body omits, and the title we
 * just set is one of them.
 */
async function setVideoCategory(
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
