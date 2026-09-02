// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FeedbackStatus } from "../api.js";
import { WatchPanel } from "./WatchPanel.js";

const status = (over: Partial<FeedbackStatus> = {}): FeedbackStatus => ({
  broadcastId: "bc1",
  title: "Tonight",
  privacyStatus: "public",
  isLive: true,
  noTarget: false,
  ...over,
});

const frame = () => document.querySelector("iframe");

afterEach(cleanup);

describe("WatchPanel (issue 065)", () => {
  it("loads the player only when the operator asks for it", () => {
    render(<WatchPanel status={status()} />);
    expect(frame()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /play/i }));

    expect(frame()?.getAttribute("src")).toBe("https://www.youtube.com/embed/bc1?autoplay=1");
  });

  // One press, not two: the operator asked for the view, so they should not have to find
  // YouTube's own play button inside the frame to get it.
  it("starts the frame playing off the operator's press", () => {
    render(<WatchPanel status={status()} />);
    fireEvent.click(screen.getByRole("button", { name: /play/i }));

    expect(frame()?.getAttribute("src")).toContain("autoplay=1");
    expect(frame()?.getAttribute("allow")).toContain("autoplay");
  });

  // The two things that make the feature misleading if left unsaid, said before the press —
  // which is the only moment either of them can still change what the operator does.
  it("states the delay and the encoder-machine cost next to the play control", () => {
    render(<WatchPanel status={status()} />);
    expect(screen.getByText(/behind/i)).toBeTruthy();
    expect(screen.getByText(/encoder/i)).toBeTruthy();
  });

  it("keeps the delay stated while the player is running", () => {
    render(<WatchPanel status={status()} />);
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    expect(screen.getByText(/behind/i)).toBeTruthy();
  });

  it("sends a private broadcast to Studio, and says who is refusing the embed", () => {
    render(<WatchPanel status={status({ privacyStatus: "private" })} />);
    expect(frame()).toBeNull();
    expect(screen.getByText(/YouTube does not allow private video to be embedded/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /studio/i }).getAttribute("href"),
    ).toBe("https://studio.youtube.com/video/bc1/livestreaming");
  });

  // Nothing plays here on the Studio branch, so the delay and the encoder cost describe a frame
  // that is not on screen and cannot be put there.
  it("keeps the frame's caveats off the Studio branch", () => {
    render(<WatchPanel status={status({ privacyStatus: "private" })} />);
    expect(screen.queryByText(/encoder/i)).toBeNull();
    expect(screen.queryByText(/behind/i)).toBeNull();
  });

  // The rail reads Live from this same status. A panel saying "nothing is on air" beside it is
  // the app contradicting itself mid-show.
  it("does not call the channel idle while the show is up but unnamed", () => {
    render(<WatchPanel status={status({ broadcastId: null })} />);
    expect(frame()).toBeNull();
    expect(screen.getByText(/on air/i)).toBeTruthy();
    expect(screen.queryByText(/Nothing is on air/i)).toBeNull();
  });

  it("offers no player at all while nothing is on air", () => {
    render(<WatchPanel status={status({ isLive: false })} />);
    expect(frame()).toBeNull();
    expect(screen.queryByRole("button", { name: /play/i })).toBeNull();
  });

  // A frame left running past the end goes on showing the last thing it buffered — the most
  // convincing possible answer to "is the show still up?", and the wrong one.
  it("drops the player when the broadcast ends", () => {
    const { rerender } = render(<WatchPanel status={status()} />);
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    expect(frame()).not.toBeNull();

    rerender(<WatchPanel status={status({ isLive: false, broadcastId: null })} />);

    expect(frame()).toBeNull();
  });
});
