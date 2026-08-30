// @ts-check
// electron-builder's `files:` is an allowlist, not a filter: a module that exists in the repo but
// is missing from it is simply absent from the installed app, and the failure is a "Cannot find
// module" crash on the operator's machine at launch — after the release is cut. Nothing else in
// the suite runs the packaged tree, so this is the only place that mismatch can be caught.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = /** @type {{ files: string[] }} */ (
  yaml.load(fs.readFileSync(path.join(root, "packages/desktop/electron-builder.yml"), "utf8"))
);

/** Build-time only — these never run inside the packaged app, so they must not be shipped. */
const NON_RUNTIME_DIRS = new Set(["node_modules", "scripts"]);

/**
 * Every runtime module the main process can reach, as workspace-relative paths. Recursive: a
 * module moved into a subdirectory is exactly the case that escapes a flat readdir and still
 * crashes the packaged app at launch.
 * @param {string} dir directory to walk, relative to the repo root
 * @returns {string[]}
 */
function runtimeModulesIn(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return NON_RUNTIME_DIRS.has(entry.name) ? [] : runtimeModulesIn(`${dir}/${entry.name}`);
    }
    if (!entry.name.endsWith(".mjs") || entry.name.endsWith(".test.mjs")) return [];
    return [`${dir}/${entry.name}`];
  });
}

/**
 * Whether the allowlist ships this file — either named outright or swept up by a `**` glob, which
 * is how whole directories like packages/desktop/generated are covered.
 * @param {string} file
 * @returns {boolean}
 */
function isShipped(file) {
  return config.files.some((entry) => {
    if (entry === file) return true;
    const glob = entry.indexOf("**");
    return glob !== -1 && file.startsWith(entry.slice(0, glob));
  });
}

const runtimeModules = runtimeModulesIn("packages/desktop");

describe("electron-builder file list", () => {
  it("ships every desktop runtime module", () => {
    expect(runtimeModules.length).toBeGreaterThan(0);
    for (const file of runtimeModules) {
      expect(isShipped(file) ? file : `${file} (missing from electron-builder files)`).toBe(file);
    }
  });

  it("does not ship test files", () => {
    expect(config.files.filter((entry) => entry.includes(".test."))).toEqual([]);
  });
});
