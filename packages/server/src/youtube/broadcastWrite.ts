/**
 * The single path every broadcast write goes through.
 *
 * `liveBroadcasts.update` is a PUT, not a PATCH: any property omitted from the request body is
 * **deleted** from the resource. One sloppy write wipes a description, or turns auto-start off on
 * tonight's show, and nothing looks broken until air. So every write here is read-modify-write —
 * `current` is what the GET returned, `next` is that same object with the edit applied — and this
 * module refuses the write if `next` has lost anything `current` had.
 */
import type { youtube_v3 } from "googleapis";
import type { BroadcastResource } from "../core/resolve.js";
import { mapYouTubeError } from "./client.js";
import { AppError } from "../core/errors.js";

/**
 * The parts every read and every write names. Reads and writes must agree: a part fetched but not
 * written back leaves fields YouTube then deletes, and a part written but not fetched sends an
 * empty object over a populated one. Exported so the read side cannot drift from it.
 */
export const BROADCAST_PARTS = ["id", "snippet", "status", "contentDetails"];

/** Sends the full merged resource back, having checked that it is in fact full. */
export async function writeBroadcast(
  yt: youtube_v3.Youtube,
  current: BroadcastResource,
  next: BroadcastResource,
): Promise<void> {
  // Guard before the defaults go in: withMonitorStream cannot tell a monitorStream the caller
  // dropped from one the GET never had, so it must not get the chance to backfill over a loss.
  const dropped = droppedFields(current, next);
  if (dropped.length > 0) {
    throw new AppError(
      "BROADCAST_WRITE_UNSAFE",
      `Refusing to write broadcast ${current.id ?? "?"}: the update body is missing ` +
        `${dropped.join(", ")}, which YouTube would delete from the resource.`,
    );
  }

  const body = withMonitorStream(next);
  try {
    await yt.liveBroadcasts.update({
      part: BROADCAST_PARTS,
      requestBody: body as youtube_v3.Schema$LiveBroadcast,
    });
  } catch (err) {
    throw mapYouTubeError(err);
  }
}

/**
 * YouTube's documented defaults for `contentDetails.monitorStream`. An update that sends
 * `part=contentDetails` without them resets both properties, so a body that carried no
 * monitorStream is the one case where saying nothing and saying this are the same write — and
 * saying it keeps the guard below honest about what leaves the process.
 */
const DEFAULT_MONITOR_STREAM = {
  enableMonitorStream: true,
  broadcastStreamDelayMs: 0,
} as const;

/** The outgoing body, with monitorStream guaranteed present. */
function withMonitorStream(next: BroadcastResource): BroadcastResource {
  const contentDetails = next.contentDetails ?? {};
  // Nullish, not `!== undefined`: googleapis types every field as nullable, and sending
  // `monitorStream: null` under `part=contentDetails` resets both properties just as omitting it does.
  if (contentDetails.monitorStream != null) return next;
  return {
    ...next,
    contentDetails: { ...contentDetails, monitorStream: { ...DEFAULT_MONITOR_STREAM } },
  };
}

/**
 * Every key path present on `current` but missing from `next`, in traversal order. Only presence
 * is compared, never values — changing a field is the whole point; losing one is the hazard.
 * `undefined` counts as missing: the body is JSON-serialized on the way out, and a key whose value
 * is `undefined` never reaches YouTube, so it is a deletion however it reads in memory.
 */
function droppedFields(
  current: unknown,
  next: unknown,
  path: string[] = [],
): string[] {
  if (!isPlainObject(current)) return [];
  if (!isPlainObject(next)) return path.length > 0 ? [path.join(".")] : [];
  const missing: string[] = [];
  for (const [key, value] of Object.entries(current)) {
    const here = [...path, key];
    if (next[key] === undefined) {
      missing.push(here.join("."));
      continue;
    }
    missing.push(...droppedFields(value, next[key], here));
  }
  return missing;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
