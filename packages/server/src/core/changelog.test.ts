import { describe, it, expect } from "vitest";
import { parseChangelog, findRelease } from "./changelog.js";

const CHANGELOG = `# Changelog

All notable changes. Generated from Conventional Commits.

## [2.2.0] - 2026-08-01

### Breaking changes

- **companion:** rename the go_live action

### Added

- **desktop:** streaming-safe auto-update
- in-app What's New panel

## [2.1.0] - 2026-07-10

### Fixed

- health probe returned 500 when offline
`;

describe("parseChangelog", () => {
  const releases = parseChangelog(CHANGELOG);

  it("reads one entry per release heading, newest first, with version and date", () => {
    expect(releases.map((r) => `${r.version}@${r.date}`)).toEqual(["2.2.0@2026-08-01", "2.1.0@2026-07-10"]);
  });

  it("keeps the sections in file order and strips the list markers", () => {
    expect(releases[0].sections).toEqual([
      { title: "Breaking changes", items: ["**companion:** rename the go_live action"] },
      { title: "Added", items: ["**desktop:** streaming-safe auto-update", "in-app What's New panel"] },
    ]);
  });

  it("ignores the file's own header prose", () => {
    expect(JSON.stringify(releases)).not.toContain("Conventional Commits");
  });

  it("returns nothing for an empty or missing changelog rather than throwing", () => {
    expect(parseChangelog("")).toEqual([]);
    expect(parseChangelog("# Changelog\n\nNothing yet.\n")).toEqual([]);
  });

  it("keeps a release that has no sections — the version still shipped", () => {
    const releases = parseChangelog("## [2.0.1] - 2026-01-01\n\n_No user-facing changes._\n");
    expect(releases).toEqual([{ version: "2.0.1", date: "2026-01-01", sections: [] }]);
  });
});

describe("findRelease", () => {
  const releases = parseChangelog(CHANGELOG);

  it("finds the notes for a version", () => {
    expect(findRelease(releases, "2.1.0")?.date).toBe("2026-07-10");
  });

  it("tolerates a leading v — tags and app versions are written both ways", () => {
    expect(findRelease(releases, "v2.2.0")?.version).toBe("2.2.0");
  });

  it("returns null for an unknown or absent version rather than the wrong notes", () => {
    expect(findRelease(releases, "9.9.9")).toBeNull();
    expect(findRelease(releases, undefined)).toBeNull();
  });
});
