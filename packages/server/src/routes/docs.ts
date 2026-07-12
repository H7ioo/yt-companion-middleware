import express, { type Express } from "express";
import path from "node:path";

/**
 * Serves the two static doc sites (PRD-08 §1): the operator manual at `/guide` and the interactive
 * API console at `/docs`. Both were single 800-2000 line HTML files; both are now a directory of
 * topic pages sharing a stylesheet and a nav script, with no build step — express just serves the
 * directory, and the pages work offline inside the packaged app because nothing they load is remote.
 *
 * `/guide` and `/docs` (no trailing slash) land on each site's index. Deep links that predate the
 * split — `/guide#companion-actions`, `/docs#post-api-action-preset` — also land there, and the
 * page's own nav script forwards the fragment to whichever page now owns it. The server never sees
 * a fragment, so this redirect cannot be done here.
 *
 * @param app     the express app to mount on
 * @param dir     the `public/` directory holding `guide/` and `docs/`
 */
export function mountDocsRoutes(app: Express, dir: string): void {
  app.use("/guide", express.static(path.join(dir, "guide")));
  app.use("/docs", express.static(path.join(dir, "docs")));
}
