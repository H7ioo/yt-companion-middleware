/**
 * The words used when a prepared broadcast is removed (PRD-16 §5, issue 064).
 *
 * They live in the shared contract for one reason: the dashboard's confirmation dialog and the
 * server's refusal of an unconfirmed delete must say the same thing. Two copies of this text
 * would drift, and the half that drifts is the half the operator reads before pressing.
 */
import type { PreparedBroadcast } from "./schema.js";

/** The question and the harm, kept apart so the dialog can set them differently. */
export interface DeleteConfirmation {
  question: string;
  warning: string;
}

/**
 * What the operator is asked before a broadcast this app created is deleted by hand.
 *
 * "Are you sure?" tells them nothing they did not already know, so the question names the
 * broadcast and the warning names the link — deleting breaks it for everyone already holding it,
 * which is the one consequence that does not undo. Same shape as the stream-binding confirmation
 * in issue 051.
 */
export function deleteConfirmation(record: PreparedBroadcast): DeleteConfirmation {
  const shared =
    record.privacyStatus === "private"
      ? `Its link stops working: ${record.watchUrl}`
      : `Its link stops working for anyone who already has it: ${record.watchUrl}`;
  return {
    question: `Delete “${record.title}” from YouTube?`,
    warning: `${shared} This cannot be undone — the broadcast is gone from the channel.`,
  };
}

/** Why an automatic retirement happened, in one line the operator can read in the log. */
export function describeRetireReason(scheduledStartTime: string | null): string {
  const when = scheduledStartTime ? ` It was scheduled for ${scheduledStartTime}.` : "";
  return `Created here, never went to air, and its start time has passed.${when}`;
}
