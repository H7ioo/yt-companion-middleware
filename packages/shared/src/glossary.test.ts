import { describe, expect, it } from "vitest";
import { canCreateBroadcasts, describeTarget, LIVE_ELIGIBILITY_GLOSSARY } from "./glossary.js";

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
