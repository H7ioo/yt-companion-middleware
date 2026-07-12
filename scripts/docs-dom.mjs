// @ts-check
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

/**
 * The jsdom harness for the doc sites, shared by every test that needs a doc page actually running.
 *
 * These pages are the only browser code in the repo with no framework and no build step behind them:
 * a typo in `nav.js`, `console.js` or `layouts.js` is invisible to typecheck, invisible to the static
 * page tests, and shows up as an empty sidebar in front of an operator. So run the pages for real.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
export const publicDir = path.resolve(here, "..", "packages", "server", "public");

/** Load a doc page with its scripts executed, resolving relative `./assets/*` against disk. */
export function render(/** @type {string} */ page) {
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
  // Serve it from the URL it really lives at: the scripts read location to decide which page they
  // are on, and the console needs a non-opaque origin for localStorage.
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
  return { doc: dom.window.document, window: dom.window, errors };
}

/** The `rgb(r, g, b)` string a browser reports for a packed Companion colour. */
export function rgbString(/** @type {number} */ packed) {
  return `rgb(${(packed >> 16) & 0xff}, ${(packed >> 8) & 0xff}, ${packed & 0xff})`;
}
