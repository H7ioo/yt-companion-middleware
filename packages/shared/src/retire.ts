/**
 * The words used when a broadcast is removed (PRD-16 §5, issue 064; §9, issue 071).
 *
 * They live in the shared contract for one reason: the dashboard's confirmation dialog and the
 * server's refusal of an unconfirmed delete must say the same thing. Two copies of this text
 * would drift, and the half that drifts is the half the operator reads before pressing.
 */
import type { PreparedBroadcast, PrivacyStatus } from "./schema.js";

/** The question and the harm, kept apart so the dialog can set them differently. */
export interface DeleteConfirmation {
  question: string;
  warning: string;
}

/**
 * The little a confirmation needs to know about what is being deleted.
 *
 * Narrower than `PreparedBroadcast` on purpose: since issue 071 the operator can delete a
 * broadcast this app never made, and there is no ownership record to describe one. What the
 * channel listing carries — a title, an id the watch link is built from, a privacy value — is
 * exactly this, and `appCreated` is the one fact the record was previously standing in for.
 */
export interface DeleteSubject {
  title: string;
  watchUrl: string;
  privacyStatus: PrivacyStatus | string | null;
  /**
   * Whether this app created it. Not a permission — issue 071 settled that a human pressing
   * Delete on a row they chose may delete anything on the channel — but a limit on what the
   * warning may claim. For a broadcast made elsewhere, this app never had the link and cannot
   * say where it has been.
   */
  appCreated: boolean;
}

/** The ownership record, read as a subject. */
export function subjectOf(record: PreparedBroadcast): DeleteSubject {
  return {
    title: record.title,
    watchUrl: record.watchUrl,
    privacyStatus: record.privacyStatus,
    appCreated: true,
  };
}

/**
 * What the operator is asked before a broadcast is deleted by hand.
 *
 * "Are you sure?" tells them nothing they did not already know, so the question names the
 * broadcast and the warning names the link — deleting breaks it for everyone already holding it,
 * which is the one consequence that does not undo. Same shape as the stream-binding confirmation
 * in issue 051.
 *
 * For a broadcast this app did not create the warning says so and stops short of the claim it
 * cannot make: the app never handed that link out, never saw it created, and has no idea whether
 * it is in a bulletin or in nobody's hands at all. Guessing in either direction would be the one
 * sentence the operator reads before an irreversible press.
 */
export function deleteConfirmation(subject: DeleteSubject): DeleteConfirmation {
  const shared = subject.appCreated
    ? subject.privacyStatus === "private"
      ? `Its link stops working: ${subject.watchUrl}`
      : `Its link stops working for anyone who already has it: ${subject.watchUrl}`
    : `This app did not create this broadcast, so it cannot say where its link has been. ` +
      `The link stops working: ${subject.watchUrl}`;
  return {
    question: `Delete “${subject.title}” from YouTube?`,
    warning: `${shared} This cannot be undone — the broadcast is gone from the channel.`,
  };
}

/** Why an automatic retirement happened, in one line the operator can read in the log. */
export function describeRetireReason(scheduledStartTime: string | null): string {
  const when = scheduledStartTime ? ` It was scheduled for ${scheduledStartTime}.` : "";
  return `Created here, never went to air, and its start time has passed.${when}`;
}

/**
 * Lifecycle states that mean the broadcast has been on air, or is on air now.
 *
 * Shared because three surfaces turn on exactly this set and disagreeing about it is a bug in
 * both directions: the sweep's `airedAtOf`, the delete route's refusal, and the dashboard row
 * that decides whether to offer a Delete button at all. A copy that drifts either hides the
 * button on something deletable or offers one the server will refuse.
 *
 * `testing` counts: YouTube only moves a broadcast there once an encoder is feeding it, and
 * deleting a broadcast mid-test takes the show off the channel while the operator is looking
 * at it.
 */
export const AIRED_LIFECYCLE_STATES: ReadonlySet<string> = new Set([
  "live",
  "liveStarting",
  "testing",
  "testStarting",
  "complete",
]);
