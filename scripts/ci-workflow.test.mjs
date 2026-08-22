// @ts-check
// The PR gate itself (issue 041 part 1). Nothing else checks a pull request: release.yml and
// nightly.yml run on a tag/schedule, so without ci.yml a branch can merge into main with red
// types or failing tests and the break is first seen at release time (PRD-05 §1.1, §3).
//
// These assertions are about the gate's *shape*, not its output — a workflow only proves itself
// on a real run, but the ways it silently stops gating (wrong trigger, a step list that drifts
// from preflight, a Node version that doesn't match release.yml) are all readable from the file.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @returns {any} */
function workflow(/** @type {string} */ name) {
  return yaml.load(fs.readFileSync(path.join(root, ".github", "workflows", name), "utf8"));
}

const ci = workflow("ci.yml");
const release = workflow("release.yml");

/** The single job in ci.yml — named indirectly so a rename doesn't break every assertion. */
const job = Object.values(ci.jobs ?? {})[0];

/** Every `run:` line in a job, flattened. @returns {string[]} */
function runs(/** @type {any} */ j) {
  return (j?.steps ?? []).flatMap((/** @type {any} */ s) => (s.run ? [String(s.run).trim()] : []));
}

describe("ci.yml triggers", () => {
  // `on` is YAML 1.1's boolean true, which is why this reads as ci[true] after a js-yaml load.
  const on = ci.on ?? ci[true];

  it("runs on every pull request", () => {
    expect(on).toHaveProperty("pull_request");
  });

  it("runs on pushes to main, so the merge commit itself is checked", () => {
    expect(on.push.branches).toContain("main");
  });

  it("cancels superseded runs on the same ref instead of burning minutes on both", () => {
    expect(ci.concurrency["cancel-in-progress"]).toBe(true);
    expect(ci.concurrency.group).toContain("github.ref");
  });
});

describe("ci.yml job", () => {
  it("drives the preflight orchestrator so CI and local preflight cannot drift", () => {
    expect(runs(job)).toContain("npm run preflight -- --no-pack");
  });

  it("does not re-list preflight's own steps in YAML", () => {
    // Any of these appearing here means the step list has been forked into the workflow.
    const forked = runs(job).filter((r) => /^npm (run )?(typecheck|test|build:all|smoke)/.test(r));
    expect(forked).toEqual([]);
  });

  it("installs companion-module's deps — preflight's test and package steps need them", () => {
    const step = (job.steps ?? []).find(
      (/** @type {any} */ s) => s.run === "npm ci" && s["working-directory"] === "companion-module",
    );
    expect(step).toBeDefined();
  });

  it("installs from the lockfile", () => {
    expect(runs(job)).toContain("npm ci");
  });

  it("uses the same Node version as the release workflow", () => {
    /** @returns {any} */
    const setupNode = (/** @type {any} */ j) =>
      (j.steps ?? []).find((/** @type {any} */ s) => String(s.uses ?? "").startsWith("actions/setup-node"));
    expect(String(setupNode(job).with["node-version"])).toBe(
      String(setupNode(release.jobs.checks).with["node-version"]),
    );
  });

  it("caches npm downloads", () => {
    const setup = (job.steps ?? []).find((/** @type {any} */ s) =>
      String(s.uses ?? "").startsWith("actions/setup-node"),
    );
    expect(setup.with.cache).toBe("npm");
  });

  it("skips the pack — the slow Electron stage nightly.yml and release.yml already cover", () => {
    expect(runs(job).some((r) => r.includes("--no-pack"))).toBe(true);
  });
});

describe("RELEASING.md", () => {
  const releasing = fs.readFileSync(path.join(root, "RELEASING.md"), "utf8");

  it("tells contributors PRs are gated by this check", () => {
    expect(releasing).toMatch(/ci\.yml/);
  });

  it("still names the local preflight (with the pack) as the pre-tag ritual", () => {
    expect(releasing).toMatch(/npm run preflight/);
  });
});
