/**
 * Changing a broadcast that already exists (PRD-16 §9, issue 070).
 *
 * Everything here is pure: an edit is a function of the resource YouTube just returned and what
 * the operator asked to change. The write itself stays in `writeBroadcast`, which is the one
 * guarded path to `liveBroadcasts.update` (issue 056) — an edit that reaches YouTube by any
 * other route is a bug, because `update` is a PUT and deletes whatever the body omits.
 */
import { setupLock, type BroadcastEditRequest } from "@app/shared";
import type { BroadcastResource } from "../core/resolve.js";

/**
 * One operator's edit, exactly as the dashboard sends it. Defined in `@app/shared` because the
 * form building the body and the route parsing it must not drift.
 */
export type BroadcastEdit = BroadcastEditRequest;

/** The `contentDetails` flags, named once so the form, the lock and the merge cannot drift. */
export const CONTENT_DETAIL_FLAGS = [
  "enableAutoStart",
  "enableAutoStop",
  "enableDvr",
  "enableClosedCaptions",
  "enableEmbed",
  "recordFromStart",
] as const;

export type ContentDetailFlag = (typeof CONTENT_DETAIL_FLAGS)[number];

/**
 * The edit's fields that YouTube only accepts before an encoder has bound — the `contentDetails`
 * flags and the ingestion key. Named as they appear in the request, so a refusal can say which
 * control the operator has to leave alone.
 */
export function setupFieldsIn(edit: BroadcastEdit): string[] {
  const named: string[] = [];
  for (const flag of CONTENT_DETAIL_FLAGS) {
    if (edit[flag] !== undefined) named.push(flag);
  }
  if (edit.enableMonitorStream !== undefined) named.push("enableMonitorStream");
  if (edit.streamId !== undefined) named.push("streamId");
  return named;
}

/**
 * The setup lock as read from the resource itself. Re-exported through this module so callers
 * ask one question of one place; the rule lives in `@app/shared` because the form disables the
 * same controls the server refuses, and those two must agree to the word.
 */
export function lockOf(current: BroadcastResource) {
  return setupLock(
    (current.status as { lifeCycleStatus?: string | null } | null | undefined)?.lifeCycleStatus,
  );
}

/**
 * The resource as it should be written back: the GET, with the edit laid over it.
 *
 * Deep-cloned, because `writeBroadcast` refuses the write by comparing what came back from
 * YouTube against what is about to go out — and a merge that mutated the original would have
 * nothing honest left to compare against.
 */
export function applyBroadcastEdit(
  current: BroadcastResource,
  edit: BroadcastEdit,
): BroadcastResource {
  const next: BroadcastResource = structuredClone(current);
  next.snippet = next.snippet ?? {};
  next.status = next.status ?? {};
  next.contentDetails = next.contentDetails ?? {};

  if (edit.title !== undefined) next.snippet.title = edit.title;
  if (edit.description !== undefined) next.snippet.description = edit.description;
  if (edit.scheduledStartTime !== undefined)
    next.snippet.scheduledStartTime = edit.scheduledStartTime;
  if (edit.scheduledEndTime !== undefined) next.snippet.scheduledEndTime = edit.scheduledEndTime;
  if (edit.privacyStatus !== undefined) next.status.privacyStatus = edit.privacyStatus;

  for (const flag of CONTENT_DETAIL_FLAGS) {
    if (edit[flag] !== undefined) next.contentDetails[flag] = edit[flag];
  }
  if (edit.enableMonitorStream !== undefined) {
    // The whole `monitorStream` object is re-sent, not just the flag: `part=contentDetails`
    // resets every property the object omits, and `broadcastStreamDelayMs` is one of them.
    const monitor = (next.contentDetails.monitorStream ?? {}) as Record<string, unknown>;
    next.contentDetails.monitorStream = {
      ...monitor,
      enableMonitorStream: edit.enableMonitorStream,
    };
  }

  return next;
}
