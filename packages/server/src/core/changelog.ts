import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReleaseNotes, ReleaseSection } from "@app/shared";

/**
 * Reader for the CHANGELOG.md that ships inside the app (PRD-09 §B.2, issue 040).
 *
 * The file is generated from the commit history at release time (scripts/changelog.mjs, issue 039)
 * and bundled into the build, so the notes the operator reads always match the binary they are
 * running and need no network — the dashboard is often the only thing up when a stream is not.
 *
 * A tiny hand-rolled reader rather than a markdown library: the input is our own generator's
 * output, and its shape is fixed by changelog.test.mjs on the other side.
 */

const HEADING = /^##\s+\[([^\]]+)\]\s+-\s+(\S+)\s*$/;
const SECTION = /^###\s+(.+?)\s*$/;
const ITEM = /^-\s+(.+?)\s*$/;

/**
 * Parses the changelog into one entry per release, newest first (the file's own order).
 * Anything that isn't a release heading, section heading or list item — the file's prose header,
 * the "_No user-facing changes._" line — is skipped.
 */
export function parseChangelog(markdown: string): ReleaseNotes[] {
  const releases: ReleaseNotes[] = [];
  let release: ReleaseNotes | null = null;
  let section: ReleaseSection | null = null;

  for (const line of markdown.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      release = { version: heading[1], date: heading[2], sections: [] };
      section = null;
      releases.push(release);
      continue;
    }
    if (!release) continue; // prose above the first release heading

    const sectionHeading = SECTION.exec(line);
    if (sectionHeading) {
      section = { title: sectionHeading[1], items: [] };
      release.sections.push(section);
      continue;
    }

    const item = ITEM.exec(line);
    if (item && section) section.items.push(item[1]);
  }

  return releases;
}

/** The notes for one version, tolerating a `v` prefix on either side. Null when not found. */
export function findRelease(releases: ReleaseNotes[], version: string | undefined): ReleaseNotes | null {
  if (!version) return null;
  const bare = version.replace(/^v/, "");
  return releases.find((r) => r.version.replace(/^v/, "") === bare) ?? null;
}

/**
 * Loads the bundled changelog. `changelogPath` comes from the host (Electron points at the copy
 * inside the asar); otherwise we walk up from this file, which finds the repo-root CHANGELOG.md in
 * a dev/Docker boot. A missing file is not an error — the app simply has no notes to show.
 */
export function loadChangelog(changelogPath?: string): ReleaseNotes[] {
  const candidates = changelogPath ? [changelogPath] : defaultPaths();
  for (const candidate of candidates) {
    try {
      return parseChangelog(fs.readFileSync(candidate, "utf8"));
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

function defaultPaths(): string[] {
  // From packages/server/dist/core/ (built) or packages/server/src/core/ (dev), the repo root —
  // and the asar root, which has the same shape — is four levels up.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(here, "..", "..", "..", "..", "CHANGELOG.md"),
    path.resolve(here, "..", "..", "..", "..", "..", "CHANGELOG.md"),
  ];
}
