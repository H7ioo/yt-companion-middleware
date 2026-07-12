#!/usr/bin/env node
// @ts-check
// CHANGELOG.md generator (PRD-09 §B.1, issue 039).
//
// One source, zero manual authoring: the repo already mandates Conventional Commits (AGENTS.md), so
// the changelog IS the commit history, grouped by type and stamped per tag. The same render feeds
// both the file and the GitHub Release body, which is what keeps them from drifting — the release
// job writes the notes with `--notes-out` and hands them to softprops/action-gh-release.
//
// Deliberately dependency-free (git + string work) in the style of the other scripts here: the
// parsing/grouping/rendering are pure and unit-tested, and only the thin `git` shim touches the world.
//
// Usage (from repo root):
//   npm run changelog                        # regenerate CHANGELOG.md from the tag history
//   node scripts/changelog.mjs --version 2.2.0 --notes-out notes.md
//     ^ what CI runs on a tag: folds the not-yet-tagged commits into the version being cut and
//       writes that one section out as the Release body.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {object} Commit
 * @property {string} type          Conventional Commit type (feat, fix, docs, …).
 * @property {string | null} scope
 * @property {boolean} breaking
 * @property {string} description
 *
 * @typedef {object} Release
 * @property {string} version       Bare semver, no leading v.
 * @property {string} date          ISO date (YYYY-MM-DD).
 * @property {Commit[]} commits
 *
 * @typedef {object} Section
 * @property {string} title
 * @property {Commit[]} commits
 */

/**
 * Conventional Commit type -> Keep a Changelog section. Types absent from this map (chore, test,
 * ci, build, style, refactor's noise) are housekeeping: real work, but not something an operator
 * reading release notes needs. Breaking changes get their own section regardless of type.
 * @type {Record<string, string>}
 */
const SECTION_FOR_TYPE = {
  feat: "Added",
  fix: "Fixed",
  perf: "Changed",
  refactor: "Changed",
  docs: "Documentation",
};

/** Section order in the rendered release, most consequential first. */
const SECTION_ORDER = ["Breaking changes", "Added", "Changed", "Fixed", "Documentation"];

const SUBJECT = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s+(?<description>.+)$/;

/**
 * @param {string} subject   Commit subject line.
 * @param {string} [body]    Commit body, for the BREAKING CHANGE footer.
 * @returns {Commit | null}  null for anything that isn't a Conventional Commit (merges, WIP).
 */
export function parseCommit(subject, body = "") {
  const match = SUBJECT.exec(subject.trim());
  if (!match?.groups) return null;
  const { type, scope, bang, description } = match.groups;
  return {
    type,
    scope: scope ?? null,
    breaking: Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body),
    description,
  };
}

/**
 * @param {Commit[]} commits
 * @returns {Section[]}  Only non-empty sections, in SECTION_ORDER.
 */
export function groupCommits(commits) {
  /** @type {Map<string, Commit[]>} */
  const buckets = new Map();
  for (const commit of commits) {
    // A breaking change is listed once, under Breaking changes — repeating it under "Added" would
    // let a reader skim past the one line that can cost them a working Companion config.
    const title = commit.breaking ? "Breaking changes" : SECTION_FOR_TYPE[commit.type];
    if (!title) continue;
    const bucket = buckets.get(title) ?? [];
    bucket.push(commit);
    buckets.set(title, bucket);
  }
  return SECTION_ORDER.filter((title) => buckets.has(title)).map((title) => ({
    title,
    commits: buckets.get(title) ?? [],
  }));
}

/**
 * One release section, Keep a Changelog style.
 * @param {Release} release
 * @returns {string}
 */
export function renderRelease({ version, date, commits }) {
  const sections = groupCommits(commits);
  const body =
    sections.length === 0
      ? "_No user-facing changes._"
      : sections
          .map(({ title, commits: list }) => {
            const lines = list.map((c) => `- ${c.scope ? `**${c.scope}:** ` : ""}${c.description}`);
            return `### ${title}\n\n${lines.join("\n")}`;
          })
          .join("\n\n");
  return `## [${version}] - ${date}\n\n${body}`;
}

/**
 * The whole file, newest release first.
 * @param {Release[]} releases
 * @returns {string}
 */
export function renderChangelog(releases) {
  const header = [
    "# Changelog",
    "",
    "All notable changes to the desktop app and the middleware. The format follows",
    "[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this file is **generated** from the",
    "Conventional Commit history by `npm run changelog` — edit the commits, not this file.",
  ].join("\n");
  return `${[header, ...releases.map(renderRelease)].join("\n\n")}\n`;
}

/**
 * Walks the tag history into one {@link Release} per tag, newest first. `git` is injected so the
 * walk is testable without a repo.
 * @param {object} options
 * @param {(args: string[]) => string} options.git
 * @param {string} [options.version]  Version being cut; folds the commits after the newest tag in.
 * @param {string} [options.today]    ISO date for that not-yet-tagged release.
 * @returns {Release[]}
 */
export function collectReleases({ git, version, today = new Date().toISOString().slice(0, 10) }) {
  const tags = git(["tag", "--list", "v*", "--sort=-v:refname"])
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);

  /** Commits in a revision range, oldest-format first — %s\n%b per record, NUL-separated. */
  const commitsIn = (range) =>
    git(["log", "--format=%s%n%b%x00", range])
      .split("\0")
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [subject, ...rest] = record.split("\n");
        return parseCommit(subject, rest.join("\n"));
      })
      .filter((c) => c !== null);

  /** @type {Release[]} */
  const releases = [];

  const bare = version?.replace(/^v/, "");
  // On a tag push CI checks the tag out, so the version being cut is usually already in `tags` —
  // only fold a pending section in when it genuinely isn't tagged yet (a local dry run).
  if (bare && !tags.includes(`v${bare}`)) {
    releases.push({
      version: bare,
      date: today,
      commits: commitsIn(tags[0] ? `${tags[0]}..HEAD` : "HEAD"),
    });
  }

  for (const [i, tag] of tags.entries()) {
    const previous = tags[i + 1];
    releases.push({
      version: tag.replace(/^v/, ""),
      date: git(["show", "-s", "--format=%cs", tag]).trim(),
      commits: commitsIn(previous ? `${previous}..${tag}` : tag),
    });
  }

  return releases;
}

/**
 * @param {string[]} argv
 * @returns {{ version?: string, notesOut?: string }}
 */
export function parseArgs(argv) {
  /** @type {{ version?: string, notesOut?: string }} */
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--version") options.version = argv[++i];
    else if (argv[i] === "--notes-out") options.notesOut = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return options;
}

/** @param {string[]} args */
const runGit = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

function main() {
  const { version, notesOut } = parseArgs(process.argv.slice(2));
  const releases = collectReleases({ git: runGit, version });

  const changelog = path.join(root, "CHANGELOG.md");
  fs.writeFileSync(changelog, renderChangelog(releases), "utf8");
  console.log(`changelog: wrote ${path.relative(root, changelog)} — ${releases.length} release(s)`);

  if (notesOut) {
    const latest = releases[0];
    if (!latest) throw new Error("no releases to write notes for");
    // The Release body is the same render, minus the version heading GitHub already shows as the title.
    const notes = renderRelease(latest).split("\n").slice(2).join("\n").trim();
    fs.writeFileSync(notesOut, `${notes}\n`, "utf8");
    console.log(`changelog: wrote ${notesOut} — notes for v${latest.version}`);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
