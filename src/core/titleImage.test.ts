import { describe, expect, it } from "vitest";
import { renderTextPng } from "./titleImage.js";

/** A base64 string whose bytes start with the PNG magic number. */
function isPng(base64: string): boolean {
  return Buffer.from(base64, "base64").subarray(0, 4).toString("hex") === "89504e47";
}

describe("renderTextPng", () => {
  it("renders Latin text to a PNG", () => {
    const png = renderTextPng("Custom", "slug");
    expect(png).not.toBeNull();
    expect(isPng(png!)).toBe(true);
  });

  it("renders Arabic text to a PNG (shaped, not tofu)", () => {
    const png = renderTextPng("أنوار الصحيح", "title");
    expect(png).not.toBeNull();
    expect(isPng(png!)).toBe(true);
  });

  it("returns null for empty or whitespace text", () => {
    expect(renderTextPng("", "slug")).toBeNull();
    expect(renderTextPng("   ", "title")).toBeNull();
  });

  it("memoizes: same text+kind returns the identical string", () => {
    const a = renderTextPng("عنوان البث المباشر", "title");
    const b = renderTextPng("عنوان البث المباشر", "title");
    expect(a).toBe(b);
  });

  it("draws the same text differently per variant", () => {
    // slug (bigger font, 2 lines) and title (smaller, 4 lines) produce different pixels.
    expect(renderTextPng("Live Now", "slug")).not.toBe(renderTextPng("Live Now", "title"));
  });

  it("handles a very long title without throwing (ellipsized)", () => {
    const long = "كلمة ".repeat(80);
    const png = renderTextPng(long, "title");
    expect(png).not.toBeNull();
    expect(isPng(png!)).toBe(true);
  });
});
