import { describe, expect, it } from "vitest";
import { describeTarget } from "./glossary.js";

describe("describeTarget", () => {
  it("names the next scheduled broadcast when nothing is on air", () => {
    const term = describeTarget({ isLive: false, noTarget: false });
    expect(term.kind).toBe("upcoming");
    expect(term.label).toBe("The next upcoming broadcast");
  });
});
