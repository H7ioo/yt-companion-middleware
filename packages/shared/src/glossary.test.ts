import { describe, expect, it } from "vitest";
import { canCreateBroadcasts, describeTarget, describeTargetState, LIVE_ELIGIBILITY_GLOSSARY, TARGET_STATE_GLOSSARY } from "./glossary.js";

describe("describeTarget", () => {
  it("names the next scheduled broadcast when nothing is on air", () => {
    const term = describeTarget({ isLive: false, noTarget: false });
    expect(term.kind).toBe("upcoming");
    expect(term.label).toBe("The next upcoming broadcast");
  });
});

/**
 * Live eligibility (issue 061 / PRD-16 §6). The copy has one job beyond naming the state: to put
 * the refusal on YouTube. An operator who reads "can't create a broadcast" with no subject
 * concludes the app is broken and goes looking for a setting to change — there isn't one, and the
 * hunt ends at "Reconnect", which is the one action guaranteed to waste their evening.
 */
describe("LIVE_ELIGIBILITY_GLOSSARY", () => {
  it("names YouTube as the one refusing, in the riding copy", () => {
    expect(LIVE_ELIGIBILITY_GLOSSARY.riding.meaning).toContain("YouTube");
    expect(LIVE_ELIGIBILITY_GLOSSARY.riding.remedy).toContain("Studio");
  });

  it("says plainly that riding mode is not a sign-in fault", () => {
    // Everything else on this dashboard that refuses an operator is fixed by reconnecting. This
    // one is not, and the copy has to say so or the banner beside it will be believed instead.
    expect(LIVE_ELIGIBILITY_GLOSSARY.riding.meaning).toMatch(/sign-in|not a fault/i);
  });

  it("keeps unknown distinct from riding — nothing has been refused yet", () => {
    expect(LIVE_ELIGIBILITY_GLOSSARY.unknown.label).not.toBe(LIVE_ELIGIBILITY_GLOSSARY.riding.label);
    expect(canCreateBroadcasts({ mode: "unknown", reason: null, message: null, checkedAt: null })).toBe(
      true,
    );
  });

  it("gives every mode a label and a meaning", () => {
    for (const term of Object.values(LIVE_ELIGIBILITY_GLOSSARY)) {
      expect(term.label.length).toBeGreaterThan(0);
      expect(term.meaning.length).toBeGreaterThan(0);
    }
  });
});

describe("canCreateBroadcasts", () => {
  it("is false only in riding mode", () => {
    expect(canCreateBroadcasts({ mode: "riding", reason: "x", message: null, checkedAt: null })).toBe(
      false,
    );
    expect(canCreateBroadcasts({ mode: "driving", reason: null, message: null, checkedAt: null })).toBe(
      true,
    );
  });
});

describe("describeTargetState", () => {
  const idle = { isLive: false, noTarget: false, title: "Tonight", broadcastId: "b1" };

  it("is live when a broadcast is on air, pin or no pin", () => {
    const readout = describeTargetState(
      { isLive: true, noTarget: false, title: "On air now", broadcastId: "live1" },
      { id: "b1" },
    );
    expect(readout.state).toBe("live");
    expect(readout.title).toBe("On air now");
  });

  it("is pinned when the pin is the broadcast that resolved", () => {
    expect(describeTargetState(idle, { id: "b1" }).state).toBe("pinned");
  });

  it("is guessed when nothing is pinned", () => {
    expect(describeTargetState(idle, null).state).toBe("guessed");
  });

  it("is guessed when the pin names a broadcast that did not resolve", () => {
    // PINNED_TARGET_GONE: the pin stands but the write lands on the fallback, which is a guess.
    expect(describeTargetState(idle, { id: "somewhere-else" }).state).toBe("guessed");
  });

  it("is none, with no title, when the channel has nothing to edit", () => {
    const readout = describeTargetState(
      { isLive: false, noTarget: true, title: null, broadcastId: null },
      null,
    );
    expect(readout.state).toBe("none");
    expect(readout.title).toBeNull();
  });

  it("is legacy when the target is the channel's old default broadcast", () => {
    // Not a ranking among upcoming broadcasts, so "pin the right one" points at a list it is
    // not in — the state has to be its own.
    const readout = describeTargetState({ ...idle, persistentTarget: true }, null);
    expect(readout.state).toBe("legacy");
    expect(readout.meaning).toBe(TARGET_STATE_GLOSSARY.legacy.meaning);
  });

  it("prefers the pin over legacy when the pin resolved", () => {
    expect(describeTargetState({ ...idle, persistentTarget: true }, { id: "b1" }).state).toBe(
      "pinned",
    );
  });

  it("is unknown, with no title, before the first refresh has resolved anything", () => {
    const readout = describeTargetState(
      { isLive: false, noTarget: false, title: null, broadcastId: null },
      { id: "b1" },
    );
    expect(readout.state).toBe("unknown");
    expect(readout.title).toBeNull();
  });

  it("carries the glossary's words for the state it resolved", () => {
    const readout = describeTargetState(idle, null);
    expect(readout.label).toBe(TARGET_STATE_GLOSSARY.guessed.label);
    expect(readout.meaning).toBe(TARGET_STATE_GLOSSARY.guessed.meaning);
  });
});
