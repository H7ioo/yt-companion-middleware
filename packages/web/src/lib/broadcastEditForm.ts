/**
 * The two things the edit form turns on that are worth pinning apart from the component
 * (issue 070): **what actually changed**, and **what pressing Save will cost**.
 *
 * Both are the same question asked twice. The form holds every field, but a PUT that re-sends
 * the whole resource is charged per resource touched — so an edit of the title costs one read
 * and one write, and an edit of the category costs a different read and a different write on the
 * video. Sending only what moved is what keeps the cost line honest, and it is what stops a
 * category-only edit from spending 50 units re-writing a broadcast nobody changed.
 */
import type { BroadcastEditRequest, BroadcastEditView, PrivacyStatus } from "../api.js";
import { isoToLocalInput, localInputToIso } from "./prepareForm.js";

/** The form's own state — strings and booleans, in the shapes the controls hold them in. */
export interface EditFormValues {
  title: string;
  description: string;
  /** `datetime-local` values, in the operator's own clock. Empty means "no time". */
  startsAt: string;
  endsAt: string;
  privacyStatus: PrivacyStatus;
  category: string | null;
  streamId: string | null;
  enableAutoStart: boolean;
  enableAutoStop: boolean;
  enableDvr: boolean;
  enableClosedCaptions: boolean;
  enableEmbed: boolean;
  recordFromStart: boolean;
  enableMonitorStream: boolean;
}

/** The form, opened on what YouTube currently has. */
export function formFrom(view: BroadcastEditView): EditFormValues {
  return {
    title: view.title,
    description: view.description,
    startsAt: view.scheduledStartTime ? isoToLocalInput(view.scheduledStartTime) : "",
    endsAt: view.scheduledEndTime ? isoToLocalInput(view.scheduledEndTime) : "",
    privacyStatus: (view.privacyStatus as PrivacyStatus) ?? "public",
    category: view.category,
    streamId: view.boundStreamId,
    enableAutoStart: view.enableAutoStart,
    enableAutoStop: view.enableAutoStop,
    enableDvr: view.enableDvr,
    enableClosedCaptions: view.enableClosedCaptions,
    enableEmbed: view.enableEmbed,
    recordFromStart: view.recordFromStart,
    enableMonitorStream: view.enableMonitorStream,
  };
}

const FLAGS = [
  "enableAutoStart",
  "enableAutoStop",
  "enableDvr",
  "enableClosedCaptions",
  "enableEmbed",
  "recordFromStart",
  "enableMonitorStream",
] as const;

/**
 * What moved, and only what moved.
 *
 * Times are compared as instants rather than as strings: the form holds them in the operator's
 * clock and YouTube states them in UTC, so a straight comparison would report every edit as a
 * retiming — which would cost a write on every press and, worse, reorder the will-air ranking
 * for an edit that changed nothing.
 */
export function editDiff(view: BroadcastEditView, form: EditFormValues): BroadcastEditRequest {
  const diff: BroadcastEditRequest = {};
  if (form.title !== view.title) diff.title = form.title;
  if (form.description !== view.description) diff.description = form.description;

  const startIso = localInputToIso(form.startsAt);
  if (startIso !== null && !sameInstant(startIso, view.scheduledStartTime))
    diff.scheduledStartTime = startIso;

  const endIso = form.endsAt.trim() === "" ? null : localInputToIso(form.endsAt);
  if (!sameInstant(endIso, view.scheduledEndTime)) diff.scheduledEndTime = endIso;

  if (form.privacyStatus !== view.privacyStatus) diff.privacyStatus = form.privacyStatus;
  // Null is a real value here — "leave YouTube's own default alone" — so it is compared, not
  // skipped. It is simply never *sent* as a change, because there is no way to unset a category.
  if (form.category !== view.category && form.category !== null) diff.category = form.category;
  if (form.streamId !== view.boundStreamId && form.streamId !== null)
    diff.streamId = form.streamId;

  for (const flag of FLAGS) {
    if (form[flag] !== view[flag]) diff[flag] = form[flag];
  }
  return diff;
}

/** True when both sides name the same moment, or when both name none. */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Date.parse(a) === Date.parse(b);
}

/** The `contentDetails` flags and the key — the fields the setup lock covers. */
export function touchesSetup(edit: BroadcastEditRequest): boolean {
  return FLAGS.some((f) => edit[f] !== undefined) || edit.streamId !== undefined;
}

/**
 * What Save will spend, stated in the form before the press (PRD-16 §9).
 *
 * Every edit starts with a read, because the whole resource has to be re-sent and only YouTube
 * knows what the rest of it currently is. Then a write per resource actually touched: the
 * broadcast, the video the category lives on, and the bind.
 */
export function describeEditCost(edit: BroadcastEditRequest): string {
  const touchesBroadcast = Object.keys(edit).some((k) => k !== "category" && k !== "streamId");
  let units = 1;
  const parts: string[] = ["read the broadcast"];
  if (touchesBroadcast) {
    units += 50;
    parts.push("write it back whole");
  }
  if (edit.category !== undefined && edit.category !== null) {
    units += 51;
    parts.push("read and write the video for the category");
  }
  if (edit.streamId !== undefined) {
    units += 50;
    parts.push("rebind the key");
  }
  return `Costs ${units} of the day's 10,000 quota units — ${parts.join(", ")}.`;
}
