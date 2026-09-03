import { describe, expect, it } from "vitest";
import { localInputToIso, isoToLocalInput, describePrepareCost } from "./prepareForm.js";

describe("localInputToIso", () => {
  it("reads a datetime-local value as the operator's own clock", () => {
    // The operator types the time the show starts *here*. A value parsed as UTC would schedule a
    // 19:00 service at 19:00Z — hours off, and wrong in a way nothing on the page shows.
    const iso = localInputToIso("2026-09-04T19:00");
    expect(iso).toBe(new Date(2026, 8, 4, 19, 0).toISOString());
  });

  it("returns null for an empty or unparseable value, so the form can refuse it", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("tonight")).toBeNull();
  });
});

describe("isoToLocalInput", () => {
  it("round-trips through the input's own format", () => {
    const iso = localInputToIso("2026-09-04T19:00")!;
    expect(isoToLocalInput(iso)).toBe("2026-09-04T19:00");
  });
});

describe("describePrepareCost", () => {
  it("names the two writes a preparation always costs", () => {
    expect(describePrepareCost(false)).toContain("100");
  });

  it("adds the category write when one will be set", () => {
    expect(describePrepareCost(true)).toContain("151");
  });
});
