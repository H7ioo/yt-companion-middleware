// @ts-check
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "..", "packages", "server", "public");
const guideDir = path.join(publicDir, "guide");
const docsDir = path.join(publicDir, "docs");

const read = (/** @type {string} */ p) => fs.readFileSync(p, "utf8");
const pagesIn = (/** @type {string} */ dir) =>
  fs.readdirSync(dir).filter((f) => f.endsWith(".html"));

/**
 * Every anchor the old monolithic `guide.html` exposed. Deep links to these exist in the README,
 * HELP.md, the dashboard and — worse — in operators' bookmarks, so the split must keep every one
 * of them resolving. This list is the contract; it does not shrink.
 */
const LEGACY_GUIDE_ANCHORS = [
  "overview",
  "setup",
  "auth",
  "web",
  "templates",
  "action",
  "feedback",
  "dashboard-api",
  "errors",
  "companion-conn",
  "companion-presets",
  "companion-actions",
  "companion-feedback",
  "arabic",
  "companion-redirect",
];

describe("guide pages", () => {
  it("splits the monolith into topic pages", () => {
    expect(pagesIn(guideDir).sort()).toEqual([
      "api.html",
      "companion.html",
      "dashboard.html",
      "fill-flow.html",
      "index.html",
      "layouts.html",
      "setup.html",
    ]);
    expect(fs.existsSync(path.join(publicDir, "guide.html"))).toBe(false);
  });

  it("keeps every legacy anchor resolving somewhere in the set", () => {
    const ids = new Set(
      pagesIn(guideDir).flatMap((f) =>
        [...read(path.join(guideDir, f)).matchAll(/id="([a-z-]+)"/g)].map((m) => m[1]),
      ),
    );
    for (const anchor of LEGACY_GUIDE_ANCHORS) expect([anchor, ids.has(anchor)]).toEqual([anchor, true]);
  });

  it("routes a legacy anchor to the page that now owns it", () => {
    // The nav manifest is the single source for both the sidebar and the #anchor redirect, so a
    // section cannot move pages without its deep link following it.
    const nav = read(path.join(guideDir, "assets", "nav.js"));
    for (const anchor of LEGACY_GUIDE_ANCHORS) expect(nav).toContain(`"${anchor}"`);
    expect(nav).toMatch(/location\.replace|location\.href/);
  });

  it("shares one nav and one stylesheet across the pages", () => {
    for (const f of pagesIn(guideDir)) {
      const html = read(path.join(guideDir, f));
      expect(html).toContain('href="./assets/guide.css"');
      expect(html).toContain('src="./assets/nav.js"');
      expect(html).toMatch(/<title>[^<]+<\/title>/);
    }
  });
});

describe("docs console pages", () => {
  it("splits the console into one page per bus", () => {
    expect(pagesIn(docsDir).sort()).toEqual([
      "action.html",
      "config.html",
      "feedback.html",
      "index.html",
      "presets.html",
    ]);
    expect(fs.existsSync(path.join(publicDir, "docs.html"))).toBe(false);
  });

  it("names its bus, so the shared renderer knows what to draw", () => {
    for (const bus of ["feedback", "action", "presets", "config"]) {
      expect(read(path.join(docsDir, `${bus}.html`))).toContain(`data-bus="${bus}"`);
    }
    expect(read(path.join(docsDir, "index.html"))).not.toContain("data-bus=");
  });

  it("keeps the endpoint data and the tester in shared assets", () => {
    const buses = read(path.join(docsDir, "assets", "buses.js"));
    for (const bus of ["feedback", "action", "presets", "config"]) {
      expect(buses).toContain(`id: "${bus}"`);
    }
    // The routes the console documents — a dropped one here means an undocumented endpoint.
    for (const route of [
      "/api/feedback/health",
      "/api/feedback/stream",
      "/api/feedback/ws",
      "/api/action/preset",
      "/api/action/undo",
      "/api/dashboard/presets",
    ]) {
      expect(buses).toContain(route);
    }
    for (const f of pagesIn(docsDir)) {
      const html = read(path.join(docsDir, f));
      expect(html).toContain('href="./assets/console.css"');
      expect(html).toContain('src="./assets/buses.js"');
      expect(html).toContain('src="./assets/console.js"');
    }
  });

  it("sends a legacy endpoint anchor to the bus page that owns it", () => {
    const console_ = read(path.join(docsDir, "assets", "console.js"));
    expect(console_).toMatch(/location\.hash/);
    expect(console_).toMatch(/location\.replace|location\.href/);
  });
});

describe("offline safety", () => {
  it("loads nothing from the network — the packaged app has none", () => {
    for (const dir of [guideDir, docsDir]) {
      const files = fs
        .readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((f) => /\.(html|css|js)$/.test(f));
      for (const f of files) {
        const src = read(path.join(dir, f));
        // A remote stylesheet, script, font or image would render blank offline.
        expect([f, /(?:src|href)="https?:\/\//.test(src)]).toEqual([f, false]);
        expect([f, /@import\s+url\(["']?https?:/.test(src)]).toEqual([f, false]);
      }
    }
  });
});
