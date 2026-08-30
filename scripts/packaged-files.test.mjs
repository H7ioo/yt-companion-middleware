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

/** Every runtime module the main process can reach — tests and generated output excluded. */
const runtimeModules = fs
  .readdirSync(path.join(root, "packages/desktop"))
  .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"));

describe("electron-builder file list", () => {
  it("ships every desktop runtime module", () => {
    expect(runtimeModules.length).toBeGreaterThan(0);
    for (const name of runtimeModules) {
      expect(config.files).toContain(`packages/desktop/${name}`);
    }
  });

  it("does not ship test files", () => {
    expect(config.files.filter((entry) => entry.includes(".test."))).toEqual([]);
  });
});
