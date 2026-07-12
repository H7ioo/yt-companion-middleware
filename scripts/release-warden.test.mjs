// @ts-check
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const agentPath = path.join(root, ".claude", "agents", "release-warden.md");
const agent = fs.readFileSync(agentPath, "utf8");
const releasing = fs.readFileSync(path.join(root, "RELEASING.md"), "utf8");

/** Frontmatter of a Claude Code agent file: the block between the leading `---` fences. */
function frontmatter(/** @type {string} */ md) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!match) throw new Error("no frontmatter");
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of match[1].split("\n")) {
    const kv = /^([a-z]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

/** Checklist items under a `## Release checklist` heading, unwrapped to one line each. */
function checklistItems(/** @type {string} */ md) {
  const section = md.split(/^## Release checklist\s*$/m)[1] ?? "";
  return section
    .split(/\n(?=- \[)/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("- ["))
    .map((item) => item.split(/\n\s*\n/)[0]) // an item ends at the first blank line
    .map((item) => item.replace(/^- \[.?\]\s*/, "").replace(/\s+/g, " "));
}

describe("release-warden frontmatter", () => {
  it("declares the agent so it can be invoked by name", () => {
    const fm = frontmatter(agent);
    expect(fm.name).toBe("release-warden");
    expect(fm.description).toMatch(/releas/i);
  });

  it("grants only read-only tools — the warden reports, it never edits", () => {
    const tools = frontmatter(agent)
      .tools.split(",")
      .map((t) => t.trim());
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(["Read", "Grep", "Glob", "Bash"]).toContain(tool);
    }
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Write");
  });
});

describe("release-warden audit scope", () => {
  it("audits the four PRD-05 §4 areas", () => {
    // Companion version sync + upgrade script.
    expect(agent).toContain("companion-module/package.json");
    expect(agent).toContain("companion/manifest.json");
    expect(agent).toMatch(/upgrade script/i);
    // Doc freshness against the diff.
    expect(agent).toContain("README.md");
    expect(agent).toContain("companion-module/companion/HELP.md");
    expect(agent).toContain("packages/server/public/guide/");
    // Semver intent.
    expect(agent).toMatch(/semver/i);
    // Preflight + main state.
    expect(agent).toContain("npm run preflight");
    expect(agent).toMatch(/main/);
  });

  it("cites the rules rather than restating them, so they cannot drift", () => {
    expect(agent).toContain("RELEASING.md");
    expect(agent).toContain("companion-module/VERSIONING.md");
  });

  it("is advisory: it recommends, and the human cuts the tag", () => {
    expect(agent).toMatch(/advisory|report-only/i);
    expect(agent).toMatch(/never (run|cut).*(git tag|tag)|the human (cuts|runs)/i);
    // It must not tell itself to push tags or commit.
    expect(agent).not.toMatch(/^\s*git (tag|push|commit)/m);
  });
});

describe("release-warden output", () => {
  it("emits the RELEASING.md release checklist, item for item", () => {
    const expected = checklistItems(releasing);
    expect(expected.length).toBeGreaterThan(5);
    expect(checklistItems(agent)).toEqual(expected);
  });

  it("marks each item with a verdict instead of leaving it blank", () => {
    expect(agent).toContain("PASS");
    expect(agent).toContain("FLAG");
    expect(agent).toContain("HUMAN");
  });
});
