/**
 * What may be changed on a broadcast that already exists, and why the rest may not (issue 070).
 *
 * The editable set is YouTube's, not this app's, and it narrows as the broadcast moves through
 * its lifecycle. That is the whole design problem the edit form has to solve: a form that greys
 * half its fields without saying why reads as broken, and an operator who cannot tell "the app
 * will not let me" from "YouTube will not let me" goes to Studio — which is the trip this
 * feature exists to remove.
 *
 * Shared rather than server-side, deliberately. The server refuses a locked write and the form
 * disables the control, and those two must agree to the word: a field the form offers and the
 * server then refuses is worse than one that was never offered.
 */

/**
 * Whether a broadcast's *setup* — the `contentDetails` flags and the ingestion key it is bound
 * to — may still be changed, and the reason when it may not.
 *
 * Title, description, scheduled times, privacy and category are not covered here: YouTube takes
 * those in every state, including mid-show, which is exactly the edit an operator most often
 * needs at 22:58.
 */
export interface SetupLock {
  locked: boolean;
  /** Why the setup is locked, in the vocabulary the rest of the app uses. Null when it is open. */
  reason: string | null;
}

const OPEN: SetupLock = { locked: false, reason: null };

/**
 * The lock, read from the resource's `status.lifeCycleStatus` and never assumed from the
 * will-air marker — the marker is this app's ranking, and YouTube's refusal turns on its own
 * record of what the broadcast has done.
 */
export function setupLock(lifeCycleStatus: string | null | undefined): SetupLock {
  switch (lifeCycleStatus) {
    case "live":
    case "liveStarting":
      return {
        locked: true,
        reason:
          "It is on air. YouTube will not change how a broadcast is set up while it is airing.",
      };
    case "testing":
    case "testStarting":
      return {
        locked: true,
        reason:
          "The encoder is bound and previewing, so YouTube has already committed the setup. " +
          "Stop the encoder to change it.",
      };
    case "complete":
    case "revoked":
      return {
        locked: true,
        reason: "It has finished, so its setup is part of the recording now.",
      };
    default:
      // `created`, `ready`, and anything YouTube adds later. An unknown state is treated as open
      // rather than locked: the server's write is the authority, and pre-emptively greying a
      // field over a status this app has never heard of hides a control that in fact works.
      return OPEN;
  }
}
