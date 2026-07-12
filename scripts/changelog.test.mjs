// @ts-check
import { describe, it, expect } from "vitest";
import { parseCommit, groupCommits, renderRelease, renderChangelog, collectReleases } from "./changelog.mjs";

describe("parseCommit", () => {
  it("pulls type, scope and description out of a Conventional Commit subject", () => {
    expect(parseCommit("feat(desktop): streaming-safe auto-update")).toEqual({
      type: "feat",
      scope: "desktop",
      breaking: false,
      description: "streaming-safe auto-update",
    });
  });

  it("handles a scopeless subject", () => {
    expect(parseCommit("fix: quota budget went negative")).toMatchObject({
      type: "fix",
      scope: null,
      description: "quota budget went negative",
    });
  });

  it("flags a breaking change from the ! marker", () => {
    expect(parseCommit("feat(companion)!: rename the go_live action")).toMatchObject({
      type: "feat",
      breaking: true,
    });
  });

  it("flags a breaking change from a BREAKING CHANGE footer", () => {
    const commit = parseCommit("feat: new action route", "BREAKING CHANGE: the old route is gone");
    expect(commit).toMatchObject({ breaking: true });
  });

  it("ignores a non-conventional subject — merge commits and the like stay out", () => {
    expect(parseCommit("Merge pull request #12 from a/b")).toBeNull();
    expect(parseCommit("wip")).toBeNull();
  });
});

describe("groupCommits", () => {
  const commits = [
    parseCommit("feat(desktop): auto-update"),
    parseCommit("fix(server): health 500"),
    parseCommit("docs(readme): rewrite"),
    parseCommit("chore: bump deps"),
    parseCommit("test: add cases"),
    parseCommit("feat!: drop bearer auth"),
  ].filter((c) => c !== null);

  it("groups by Keep a Changelog section, breaking changes first", () => {
    const sections = groupCommits(commits);
    expect(sections.map((s) => s.title)).toEqual(["Breaking changes", "Added", "Fixed", "Documentation"]);
  });

  it("drops housekeeping types — chore/test/ci are not release notes", () => {
    const all = groupCommits(commits).flatMap((s) => s.commits.map((c) => c.description));
    expect(all).not.toContain("bump deps");
    expect(all).not.toContain("add cases");
  });

  it("lists a breaking commit under Breaking changes only, not also under its type", () => {
    const sections = groupCommits(commits);
    const added = sections.find((s) => s.title === "Added");
    expect(added?.commits.map((c) => c.description)).toEqual(["auto-update"]);
    const breaking = sections.find((s) => s.title === "Breaking changes");
    expect(breaking?.commits.map((c) => c.description)).toEqual(["drop bearer auth"]);
  });

  it("returns no sections when nothing is release-worthy", () => {
    expect(groupCommits([parseCommit("chore: tidy")].filter((c) => c !== null))).toEqual([]);
  });
});

describe("renderRelease", () => {
  const commits = ["feat(desktop): auto-update", "fix: health 500"].map((s) => parseCommit(s)).filter((c) => c !== null);

  it("stamps the version and date, and bolds the scope", () => {
    const md = renderRelease({ version: "2.1.0", date: "2026-07-12", commits });
    expect(md).toContain("## [2.1.0] - 2026-07-12");
    expect(md).toContain("### Added\n\n- **desktop:** auto-update");
    expect(md).toContain("### Fixed\n\n- health 500");
  });

  it("says so plainly when a release carries nothing release-worthy", () => {
    const md = renderRelease({ version: "2.0.1", date: "2026-01-01", commits: [] });
    expect(md).toContain("## [2.0.1] - 2026-01-01");
    expect(md).toMatch(/no user-facing changes/i);
  });
});

describe("renderChangelog", () => {
  it("writes Keep a Changelog front matter, newest release first", () => {
    const md = renderChangelog([
      { version: "2.1.0", date: "2026-07-12", commits: [parseCommit("feat: b")].filter((c) => c !== null) },
      { version: "2.0.0", date: "2026-01-01", commits: [parseCommit("feat: a")].filter((c) => c !== null) },
    ]);
    expect(md.startsWith("# Changelog\n")).toBe(true);
    expect(md).toContain("Keep a Changelog");
    expect(md.indexOf("## [2.1.0]")).toBeLessThan(md.indexOf("## [2.0.0]"));
    expect(md.endsWith("\n")).toBe(true);
  });
});

describe("collectReleases", () => {
  // Fake git: tags newest-first, and the commit subjects in each tag range.
  const git = (args) => {
    if (args[0] === "tag") return "v2.1.0\nv2.0.0\n";
    if (args[0] === "log") {
      const range = args.find((a) => a.includes("..")) ?? args.at(-1);
      if (range === "v2.0.0..v2.1.0") return "feat(desktop): auto-update\x00fix: health 500\x00";
      if (range === "v2.0.0") return "feat: first release\x00";
      return "";
    }
    if (args[0] === "show") return "2026-07-12\n";
    return "";
  };

  it("walks the tag history and builds one entry per tag, newest first", () => {
    const releases = collectReleases({ git });
    expect(releases.map((r) => r.version)).toEqual(["2.1.0", "2.0.0"]);
    expect(releases[0].commits.map((c) => c.description)).toEqual(["auto-update", "health 500"]);
    expect(releases[0].date).toBe("2026-07-12");
  });

  it("treats an unreleased HEAD as the given version, so CI can stamp the tag being cut", () => {
    const gitNoTags = (args) => (args[0] === "tag" ? "" : args[0] === "log" ? "feat: first\x00" : "2026-07-12\n");
    const releases = collectReleases({ git: gitNoTags, version: "1.0.0", today: "2026-07-12" });
    expect(releases).toEqual([
      { version: "1.0.0", date: "2026-07-12", commits: [parseCommit("feat: first")] },
    ]);
  });

  it("folds commits made after the newest tag into the version being released", () => {
    const releases = collectReleases({ git, version: "2.2.0", today: "2026-08-01" });
    expect(releases.map((r) => r.version)).toEqual(["2.2.0", "2.1.0", "2.0.0"]);
    expect(releases[0].date).toBe("2026-08-01");
  });

  it("does not invent a duplicate entry when the version being released is already tagged", () => {
    const releases = collectReleases({ git, version: "2.1.0", today: "2026-08-01" });
    expect(releases.map((r) => r.version)).toEqual(["2.1.0", "2.0.0"]);
  });
});
