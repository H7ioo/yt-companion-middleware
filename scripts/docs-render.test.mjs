// @ts-check
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

/**
 * The doc sites are the only browser code with no framework and no build step behind it: a typo in
 * `nav.js` or `console.js` is invisible to typecheck, invisible to the static page tests, and shows
 * up as an empty sidebar in front of an operator. So run the pages for real, in a DOM, and assert
 * the two shared scripts render what the split depends on.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "..", "packages", "server", "public");

/** Load a doc page with its scripts executed, resolving relative `./assets/*` against disk. */
function render(/** @type {string} */ page) {
  const file = path.join(publicDir, page);
  const dir = path.dirname(file);
  let html = fs.readFileSync(file, "utf8");
  // jsdom will not fetch `./assets/x.js` off the filesystem, so inline the scripts it would load.
  html = html.replace(/<script src="\.\/([^"]+)"><\/script>/g, (_m, src) => {
    return `<script>${fs.readFileSync(path.join(dir, src), "utf8")}</script>`;
  });
  const virtualConsole = new VirtualConsole();
  /** @type {string[]} */
  const errors = [];
  virtualConsole.on("jsdomError", (e) => errors.push(String(e)));
  // Serve it from the URL it really lives at: both scripts read location to decide which page
  // they are on, and the console needs a non-opaque origin for localStorage.
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    virtualConsole,
    url: `http://localhost:8080/${page}`,
    beforeParse(window) {
      // Electron and every target browser have it; jsdom does not. The scroll-spy it drives is
      // decoration — stub it so a missing API doesn't masquerade as a broken page.
      // @ts-expect-error — minimal stand-in for the one method nav.js calls.
      window.IntersectionObserver = class {
        observe() {}
        disconnect() {}
      };
    },
  });
  return { doc: dom.window.document, errors };
}

describe("guide pages render", () => {
  it("builds the shared sidebar on every page, with the current page expanded into sections", () => {
    const { doc, errors } = render("guide/companion.html");
    expect(errors).toEqual([]);

    const links = [...doc.querySelectorAll("nav.toc a")].map((a) => a.textContent);
    // Other pages appear as one entry each…
    expect(links).toContain("How it works");
    expect(links).toContain("Redirect / fill flow");
    // …and the page you are on expands into its own sections.
    expect(links).toContain("Every action");
    expect(links).toContain("State on the keys");

    // Every section link on the current page points at an element that exists on it.
    for (const a of doc.querySelectorAll("nav.toc a[data-section]")) {
      const id = a.getAttribute("data-section");
      expect([id, Boolean(doc.getElementById(String(id)))]).toEqual([id, true]);
    }
  });

  it("adds a pager so the split reads as one document", () => {
    const { doc } = render("guide/setup.html");
    const pager = [...doc.querySelectorAll("nav.pager a")].map((a) => a.getAttribute("href"));
    expect(pager).toEqual(["./index.html", "./dashboard.html"]);
  });
});

describe("docs console pages render", () => {
  it("draws only its own bus, as testable endpoint strips", () => {
    const { doc, errors } = render("docs/action.html");
    expect(errors).toEqual([]);

    const buses = [...doc.querySelectorAll("#buses section.bus")].map((s) => s.id);
    expect(buses).toEqual(["action"]);

    // One strip per endpoint in the bus, each with the method jack and a send button.
    const strips = [...doc.querySelectorAll("#buses .strip")].map((s) => s.id);
    expect(strips).toContain("post-api-action-preset");
    expect(strips).toContain("post-api-action-undo");
    expect(doc.querySelectorAll("#buses .strip .jack").length).toBe(strips.length);
  });

  it("keeps the rail a full index — the other buses link to their own pages", () => {
    const { doc } = render("docs/action.html");
    const railBuses = [...doc.querySelectorAll(".rail__bus")].map((a) => a.getAttribute("href"));
    expect(railBuses).toEqual([
      "./feedback.html",
      "./action.html",
      "./presets.html",
      "./config.html",
    ]);
    expect(doc.querySelector(".rail__bus.is-on")?.getAttribute("href")).toBe("./action.html");
  });

  it("makes the index a router: one card per bus", () => {
    const { doc, errors } = render("docs/index.html");
    expect(errors).toEqual([]);
    const cards = [...doc.querySelectorAll(".buscard")].map((a) => a.getAttribute("href"));
    expect(cards).toEqual([
      "./feedback.html",
      "./action.html",
      "./presets.html",
      "./config.html",
    ]);
    expect(doc.querySelectorAll("#buses section.bus").length).toBe(0);
  });
});
