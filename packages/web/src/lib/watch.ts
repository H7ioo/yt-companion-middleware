import type { FeedbackStatus } from "../api.js";

/**
 * What the panel can offer for the broadcast on air (issue 065, PRD-16 §4).
 *
 * `waiting` is not a failure: nothing is on air, or the broadcast on air cannot be named. Both
 * are ordinary states, but they are not the same state to an operator — one is an idle channel
 * and the other is a live show the app has momentarily lost the name of — so `why` carries the
 * difference through to the copy instead of flattening it.
 */
export type Watch =
  | { kind: "player"; embedUrl: string; watchUrl: string }
  | { kind: "studio"; studioUrl: string; why: string }
  | { kind: "waiting"; why: string };

/** YouTube's privacy values that permit an embed. Anything else is Studio's problem, not ours. */
const EMBEDDABLE = new Set(["public", "unlisted"]);

/**
 * Decides whether the audience's view of the broadcast can be shown here.
 *
 * Two refusals, deliberately kept apart from each other. **Nothing is embedded before the
 * broadcast is live**, because YouTube serves a waiting screen for one that has not started and
 * an operator cannot tell that apart from a show that has stalled. And **a private broadcast is
 * never embedded**: YouTube answers the frame with "Video unavailable", which mid-show reads as
 * the stream being down. Studio can play it, so the panel sends the operator there and says why.
 *
 * Unknown privacy takes the private path. The cost of guessing wrong in that direction is a
 * link nobody needed; guessing wrong in the other is a broken frame during a show.
 */
export function describeWatch(status: FeedbackStatus): Watch {
  if (!status.isLive) {
    return {
      kind: "waiting",
      why: "Nothing is on air. Once the show starts, the audience's view can be played here.",
    };
  }
  // Live with no id: the last status read said the show is up but did not name it — a refresh
  // failure, or a restart mid-show before the first refresh lands. Saying "nothing is on air"
  // here contradicts the rail, which is still reading Live from the same status.
  if (!status.broadcastId) {
    return {
      kind: "waiting",
      why: "The show is on air, but the app does not have the broadcast's id yet, so it cannot open the audience's view. It will appear at the next refresh.",
    };
  }
  const id = status.broadcastId;
  if (!EMBEDDABLE.has(status.privacyStatus ?? "")) {
    return {
      kind: "studio",
      studioUrl: `https://studio.youtube.com/video/${id}/livestreaming`,
      why:
        status.privacyStatus === "private"
          ? "This broadcast is private, and YouTube does not allow private video to be embedded. Studio can play it."
          : "The privacy of the broadcast on air is not known yet, so it is not embedded. Studio can play it either way.",
    };
  }
  return {
    kind: "player",
    // The press is the operator's own play gesture, so the frame starts playing rather than
    // making them find YouTube's button inside it.
    embedUrl: `https://www.youtube.com/embed/${id}?autoplay=1`,
    watchUrl: `https://www.youtube.com/watch?v=${id}`,
  };
}
