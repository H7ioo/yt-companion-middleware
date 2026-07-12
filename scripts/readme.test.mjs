// @ts-check
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The README is the front door for two very different people: an operator who wants the app running
 * on a machine in a control room, and a developer who wants the repo building. PRD-08 §2 (#8, #25)
 * says it routes them apart instead of mixing the paths — and that it *links* to the release docs
 * rather than growing a second, stale copy of them. These are the teeth of that.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

/** The text under a `## Heading`, up to the next `## ` — so a claim is tested where it belongs. */
function section(/** @type {RegExp} */ heading) {
  const lines = readme.split("\n");
  const start = lines.findIndex((l) => l.startsWith("## ") && heading.test(l));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

describe("README routes its two audiences", () => {
  const operators = section(/operator/i);
  const developers = section(/develop/i);

  it("has a distinct path for each", () => {
    expect(operators).not.toBe("");
    expect(developers).not.toBe("");
  });

  it("tells an operator where releases live, and installer vs portable apart", () => {
    expect(operators).toMatch(/releases/i);
    expect(operators).toMatch(/installer/i);
    expect(operators).toMatch(/portable/i);
  });

  it("warns about the unsigned-exe SmartScreen prompt instead of letting it look like malware", () => {
    expect(operators).toMatch(/SmartScreen/i);
  });

  it("walks the operator through connecting YouTube and importing the Companion package", () => {
    expect(operators).toMatch(/connect/i);
    expect(operators).toMatch(/\.tgz/);
    expect(operators).toMatch(/companion:package/);
  });

  it("gives the developer the workspace install and the command table", () => {
    expect(developers).toMatch(/npm install/);
    for (const script of ["dev", "build:all", "test", "typecheck", "preflight", "desktop:build"]) {
      expect([script, developers.includes(`npm run ${script}`) || developers.includes(`npm ${script}`)]).toEqual([
        script,
        true,
      ]);
    }
  });

  it("only names commands that exist", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    for (const [, script] of readme.matchAll(/`npm run ([a-z:]+)`?/g)) {
      expect([script, Object.hasOwn(pkg.scripts, script)]).toEqual([script, true]);
    }
  });
});

describe("README is honest about the OSes", () => {
  it("covers Windows and Linux on the operator path", () => {
    const operators = section(/operator/i);
    expect(operators).toMatch(/Windows/);
    expect(operators).toMatch(/Linux/);
    // Linux has no desktop artifact — Docker is the answer, and the README says so.
    expect(operators).toMatch(/Docker/);
  });

  it("says out loud that the desktop app is a Windows-only artifact", () => {
    // The release only carries an .exe. An operator on Linux must learn that here, not from a
    // 404 on the Releases page.
    expect(readme).toMatch(/Windows[- ]only/i);
  });
});

describe("README links instead of restating", () => {
  it("points at the release and versioning docs", () => {
    for (const target of ["RELEASING.md", "companion-module/VERSIONING.md", "companion-module/README.md"]) {
      expect([target, readme.includes(`(${target})`)]).toEqual([target, true]);
    }
  });

  it("does not grow a second copy of the release procedure", () => {
    // The tag/bump/checklist flow lives in RELEASING.md alone. A duplicate here is the copy that
    // goes stale, and it is the copy people read first.
    expect(readme).not.toMatch(/git tag v/);
    expect(readme).not.toMatch(/workflow_dispatch/);
    expect(readme).not.toMatch(/companion:bump/);
  });

  it("has no dead relative links", () => {
    // `../../releases` and friends are GitHub-relative (they resolve against the repo URL, not the
    // tree), so only in-repo paths are checkable here.
    for (const [, target] of readme.matchAll(/\]\((?!https?:|#|\.\.\/)([^)#]+)/g)) {
      expect([target, fs.existsSync(path.join(root, target))]).toEqual([target, true]);
    }
  });
});
