#!/usr/bin/env node
// @ts-check
// Local release preflight (PRD-05 §1.1, issue 031).
//
// Mirrors everything the Release workflow does EXCEPT the OS-specific packaging: typecheck (server
// + companion) and typecheck:electron, the full vitest suite (workspaces + companion-module), the
// shared/web/server build, the Companion package (whose prepackage guard re-checks the
// package.json/manifest.json version sync), and an electron-builder `--dir` pack.
//
// The pack is the point: it exercises the electron-builder files/asarUnpack globs, which otherwise
// only fail on a tag push. `--dir` packs for the host OS, so this needs no Wine on Linux — the real
// Windows installer is still proven remotely via a workflow_dispatch dry run (PRD-05 §1.2).
//
// Usage (from repo root): npm run preflight [--no-pack]
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {object} Step
 * @property {string} id
 * @property {string} why           One line on what a failure here would have cost you.
 * @property {string[]} command     argv, run from the repo root.
 */

/** The pipeline, in fail-fast order: cheapest/most-likely-to-fail first, the slow pack last. */
/** @type {Step[]} */
export const STEPS = [
  { id: "typecheck", why: "server + companion types", command: ["npm", "run", "typecheck"] },
  { id: "typecheck:electron", why: "electron entry types", command: ["npm", "run", "typecheck:electron"] },
  { id: "test", why: "all vitest suites, companion included", command: ["npm", "run", "test"] },
  { id: "build:all", why: "shared + web + server build", command: ["npm", "run", "build:all"] },
  { id: "companion:package", why: "module .tgz + version-sync guard", command: ["npm", "run", "companion:package"] },
  { id: "pack", why: "electron-builder --dir: config/glob errors", command: ["npm", "run", "desktop:pack"] },
];

/**
 * Resolves argv into the steps to run. Unknown flags throw rather than being ignored — a typo in a
 * skip flag must not quietly hand you a green preflight that checked less than you think.
 * @param {string[]} argv
 * @returns {Step[]}
 */
export function selectSteps(argv) {
  let steps = STEPS;
  for (const arg of argv) {
    if (arg === "--no-pack") steps = steps.filter((s) => s.id !== "pack");
    else throw new Error(`unknown flag "${arg}" — usage: npm run preflight [--no-pack]`);
  }
  return steps;
}

/**
 * Runs `step` from the repo root, inheriting stdio so its output streams live.
 * @param {Step} step
 * @returns {number} exit code
 */
function execStep(step) {
  const [cmd, ...args] = step.command;
  const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  return res.status ?? 1;
}

/**
 * Runs the steps in order, stopping at the first non-zero exit.
 * @param {Step[]} steps
 * @param {{ exec?: (step: Step) => number, log?: (line: string) => void }} [deps]
 * @returns {{ ok: boolean, failed?: Step }}
 */
export function runSteps(steps, deps = {}) {
  const exec = deps.exec ?? execStep;
  const log = deps.log ?? ((line) => console.log(line));
  for (const [i, step] of steps.entries()) {
    const started = Date.now();
    log(`\n▶ preflight ${i + 1}/${steps.length}: ${step.id} — ${step.why}`);
    if (exec(step) !== 0) {
      log(`\n✗ preflight failed at "${step.id}" (${step.command.join(" ")})`);
      return { ok: false, failed: step };
    }
    log(`✓ ${step.id} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
  log(`\n✓ preflight green — ${steps.length} steps. Remaining risk is the Windows build; run the`);
  log("  Release workflow via workflow_dispatch and confirm green before tagging (PRD-05 §1.2).");
  return { ok: true };
}

// Entry point when run as a script (not when imported by the tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { ok } = runSteps(selectSteps(process.argv.slice(2)));
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  }
}
