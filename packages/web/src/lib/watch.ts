import type { FeedbackStatus } from "../api.js";

/**
 * What the panel can offer for the broadcast on air (issue 065, PRD-16 §4).
 *
 * `waiting` is not a failure: nothing is on air, or the broadcast on air cannot be named. Both
 * are ordinary states of an idle channel, and neither is anything an operator acts on.
 */
export type Watch =
  | { kind: "player"; embedUrl: string; watchUrl: string }
  | { kind: "studio"; studioUrl: string; why: string }
  | { kind: "waiting" };

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
  if (!status.isLive || !status.broadcastId) return { kind: "waiting" };
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
    embedUrl: `https://www.youtube.com/embed/${id}`,
    watchUrl: `https://www.youtube.com/watch?v=${id}`,
  };
}
