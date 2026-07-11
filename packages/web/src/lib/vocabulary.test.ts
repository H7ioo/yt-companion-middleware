import { describe, it, expect } from "vitest";
import { describeBroadcastState, ACTION_GLOSSARY } from "@app/shared";

describe("describeBroadcastState", () => {
  it("names the live state On Air with a LIVE badge", () => {
    const state = describeBroadcastState({ isLive: true, noTarget: false });
    expect(state.label).toBe("On Air");
    expect(state.badge).toBe("LIVE");
  });

  it("names the not-live state Idle regardless of target", () => {
    expect(describeBroadcastState({ isLive: false, noTarget: false }).label).toBe("Idle");
    expect(describeBroadcastState({ isLive: false, noTarget: true }).badge).toBe("IDLE");
  });
});

describe("ACTION_GLOSSARY", () => {
  it("gives every operator action one canonical name bound to its endpoint", () => {
    expect(ACTION_GLOSSARY.refreshState).toEqual({
      label: "Refresh from YouTube",
      endpoint: "/api/action/refresh",
    });
    expect(ACTION_GLOSSARY.refreshLists.label).toBe("Refresh lists");
    // Distinct endpoints so the two refreshes can never collapse into one another.
    expect(ACTION_GLOSSARY.refreshState.endpoint).not.toBe(
      ACTION_GLOSSARY.refreshLists.endpoint,
    );
  });
});
