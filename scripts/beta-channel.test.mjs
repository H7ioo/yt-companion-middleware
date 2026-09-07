// @ts-check
// The beta channel's wiring (RELEASING.md §Beta channel). electron-updater asks a beta install
// for `beta.yml`, and electron-builder only emits that file when the publish config carries
// `channel: beta` — so a beta build whose channel override silently went missing publishes
// `latest.yml`, every beta check 404s, and nobody notices until a tester reports no updates.
//
// It went missing for real. Nightly passed the override as `-c.publish.channel=beta` *alongside*
// `-c packages/desktop/electron-builder.yml`: both are the same yargs alias, so on Windows the
// path lost and electron-builder tried to read a config file literally named
// `.publish.channel=beta` (`ENOENT ... \.publish.channel=beta`). Nightly was red for six days.
// electron-builder's own test for that CLI syntax is marked `ifNotWindows`, so the collision is
// not something to lean on. The channel lives in a config file now, and one `-c` selects it.
//
// These assertions are about the wiring's shape — a build only proves itself on a real run, but
// every way this silently reverts (the override moving back onto the CLI, the child config
// forgetting to extend the base, nightly building the stable config) is readable from the files.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @returns {any} */
const read = (/** @type {string} */ rel) => yaml.load(fs.readFileSync(path.join(root, rel), "utf8"));

const BASE = "packages/desktop/electron-builder.yml";
const BETA = "packages/desktop/electron-builder.beta.yml";

const base = read(BASE);
const beta = read(BETA);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
/** @type {any} */
const nightly = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/nightly.yml"), "utf8"));

/** Every `run:` line in a job, flattened. @returns {string[]} */
const runs = (/** @type {any} */ job) =>
  (job?.steps ?? []).flatMap((/** @type {any} */ s) => (s.run ? [String(s.run).trim()] : []));

const desktopJob = Object.values(nightly.jobs ?? {}).find((/** @type {any} */ j) =>
  runs(j).some((r) => r.includes("desktop:build")),
);

describe("the beta config", () => {
  it("names the beta channel, which is what makes electron-builder emit beta.yml", () => {
    expect(beta.publish.channel).toBe("beta");
  });

  // Deep-merged with the parent, so provider/owner/repo are inherited rather than copied — a
  // second copy of the publish block is a second place to update when the repo moves.
  it("inherits the rest of the build from the stable config instead of copying it", () => {
    expect(beta.extends).toBe(BASE);
    expect(Object.keys(beta)).toEqual(["extends", "publish"]);
    expect(beta.publish.provider).toBeUndefined();
  });

  it("leaves the stable config on the default channel, so a release still emits latest.yml", () => {
    expect(base.publish.channel).toBeUndefined();
  });
});

describe("the scripts that build each channel", () => {
  it("gives each channel exactly one -c, so the two can never collide on the CLI", () => {
    for (const script of [pkg.scripts["desktop:build"], pkg.scripts["desktop:build:beta"]]) {
      expect(script.match(/ -c[. ]/g)).toHaveLength(1);
      expect(script).not.toContain("-c.publish");
    }
  });

  it("points each script at its own config file", () => {
    expect(pkg.scripts["desktop:build"]).toContain(`-c ${BASE}`);
    expect(pkg.scripts["desktop:build:beta"]).toContain(`-c ${BETA}`);
  });

  // The two builds differ in one thing — the config — so everything before electron-builder is
  // shared. Duplicating the chain is how one channel quietly stops regenerating the changelog.
  it("shares every pre-build step between the two channels", () => {
    for (const script of [pkg.scripts["desktop:build"], pkg.scripts["desktop:build:beta"]]) {
      expect(script.startsWith("npm run desktop:prebuild && electron-builder")).toBe(true);
    }
  });
});

describe("nightly.yml", () => {
  it("builds the beta channel, not the stable one", () => {
    const build = runs(desktopJob).find((r) => r.includes("desktop:build"));
    expect(build).toContain("desktop:build:beta");
  });

  it("uploads the channel file a beta install actually asks for", () => {
    const upload = (desktopJob?.steps ?? []).find((/** @type {any} */ s) =>
      String(s.uses ?? "").startsWith("actions/upload-artifact"),
    );
    expect(String(upload.with.path)).toContain("release/beta.yml");
  });
});
