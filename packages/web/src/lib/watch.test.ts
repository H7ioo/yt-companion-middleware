import { describe, expect, it } from "vitest";
import type { FeedbackStatus } from "../api.js";
import { describeWatch } from "./watch.js";

const status = (over: Partial<FeedbackStatus> = {}): FeedbackStatus => ({
  broadcastId: "bc1",
  title: "Tonight",
  privacyStatus: "public",
  isLive: true,
  noTarget: false,
  ...over,
});

describe("describeWatch (issue 065)", () => {
  it("offers the player for a public broadcast that is on air", () => {
    expect(describeWatch(status())).toMatchObject({
      kind: "player",
      embedUrl: "https://www.youtube.com/embed/bc1?autoplay=1",
    });
  });

  // "Nothing is embedded before the broadcast is live": an embed of a broadcast that has not
  // started plays YouTube's own waiting screen, which looks exactly like a stalled show.
  it("offers nothing while the broadcast has not started", () => {
    expect(describeWatch(status({ isLive: false })).kind).toBe("waiting");
  });

  it("offers the player for an unlisted broadcast — a link is all an embed needs", () => {
    expect(describeWatch(status({ privacyStatus: "unlisted" })).kind).toBe("player");
  });

  // A private broadcast refuses to embed. Showing the frame anyway puts YouTube's "Video
  // unavailable" on screen mid-show, which reads as the stream being broken.
  it("routes a private broadcast to Studio instead of embedding it", () => {
    expect(describeWatch(status({ privacyStatus: "private" }))).toMatchObject({
      kind: "studio",
      studioUrl: "https://studio.youtube.com/video/bc1/livestreaming",
    });
  });

  // Same treatment as private, and for the same reason: an embed built on a guess is the one
  // outcome worth avoiding. Privacy is null before the first refresh lands.
  it("routes to Studio when the privacy of the live broadcast is not known", () => {
    expect(describeWatch(status({ privacyStatus: null })).kind).toBe("studio");
  });

  // Live with no id happens after a refresh failure, or a restart mid-show before the first
  // refresh lands. The rail is reading Live from this same status, so the panel must not answer
  // "nothing is on air" — that is the app disagreeing with itself in front of the operator.
  it("says the show is on air but unnamed, rather than calling the channel idle", () => {
    const idle = describeWatch(status({ isLive: false }));
    const unnamed = describeWatch(status({ broadcastId: null }));

    expect(unnamed.kind).toBe("waiting");
    expect(unnamed).toMatchObject({ why: expect.stringMatching(/on air/i) });
    expect(unnamed).not.toMatchObject({ why: idle.kind === "waiting" ? idle.why : "" });
  });
});
