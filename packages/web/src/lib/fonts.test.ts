import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Issue 022 / PRD-07 §1: the display heading font must be self-hosted, not pulled from a CDN.
// In the packaged Electron build there is no network guarantee, so an unbundled font silently
// falls back to Arial. These tests lock in the @font-face + bundled woff2 so a regression
// (e.g. deleting the file, or re-introducing a Google Fonts <link>/@import) fails CI.
const stylesPath = fileURLToPath(new URL("../styles.css", import.meta.url));
const fontPath = fileURLToPath(new URL("../fonts/archivo-latin-var.woff2", import.meta.url));
const styles = readFileSync(stylesPath, "utf8");

describe("display font is self-hosted (issue 022)", () => {
  it("declares an @font-face for Archivo", () => {
    expect(styles).toMatch(/@font-face/);
    expect(styles).toMatch(/font-family:\s*"Archivo"/);
  });

  it("sources Archivo from a bundled local woff2, not a URL", () => {
    const src = styles.match(/@font-face\s*\{[^}]*\}/)?.[0] ?? "";
    expect(src).toMatch(/url\(\.\/fonts\/archivo-latin-var\.woff2\)/);
    expect(src).toMatch(/format\("woff2"\)/);
  });

  it("never references an external font host", () => {
    expect(styles).not.toMatch(/fonts\.googleapis\.com/);
    expect(styles).not.toMatch(/fonts\.gstatic\.com/);
    expect(styles).not.toMatch(/@import/);
  });

  it("ships the woff2 file and it is a real (non-empty) font", () => {
    const stat = statSync(fontPath);
    expect(stat.size).toBeGreaterThan(1000);
    // woff2 magic number: ASCII "wOF2"
    const head = readFileSync(fontPath).subarray(0, 4).toString("latin1");
    expect(head).toBe("wOF2");
  });

  it("covers the display weights (600–800) via a variable weight range", () => {
    // Archivo ships as one variable file; the @font-face must expose the 600/700/800 range
    // the headings actually request, or Electron will synthesise/fall back.
    expect(styles).toMatch(/font-weight:\s*100 900/);
  });
});
