// @ts-check
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STEPS, selectSteps, runSteps } from "./preflight.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootPkg = JSON.parse(fs.readFileSync(path.resolve(here, "..", "package.json"), "utf8"));

describe("STEPS", () => {
  it("mirrors the CI pipeline: typecheck, tests, build, companion package, then a --dir pack", () => {
    expect(STEPS.map((s) => s.id)).toEqual([
      "typecheck",
      "typecheck:electron",
      "test",
      "build:all",
      "companion:package",
      "pack",
    ]);
  });

  it("runs every step through a root npm script that exists", () => {
    for (const step of STEPS) {
      expect(step.command[0]).toBe("npm");
      expect(step.command[1]).toBe("run");
      expect(rootPkg.scripts).toHaveProperty(step.command[2]);
    }
  });

  it("packs with electron-builder --dir so it needs no Wine on Linux", () => {
    const pack = STEPS.find((s) => s.id === "pack");
    expect(pack?.command[2]).toBe("desktop:pack");
    expect(rootPkg.scripts["desktop:pack"]).toContain("electron-builder --dir");
    expect(rootPkg.scripts["desktop:pack"]).not.toContain("--win");
  });
});

describe("selectSteps", () => {
  it("runs everything by default", () => {
    expect(selectSteps([])).toEqual(STEPS);
  });

  it("drops the pack step with --no-pack, for a quick loop without the electron download", () => {
    expect(selectSteps(["--no-pack"]).map((s) => s.id)).not.toContain("pack");
    expect(selectSteps(["--no-pack"])).toHaveLength(STEPS.length - 1);
  });

  it("rejects an unknown flag rather than silently skipping checks", () => {
    expect(() => selectSteps(["--skip-tests"])).toThrow(/--skip-tests/);
  });
});

describe("runSteps", () => {
  it("fails fast: stops at the first broken step and reports it", () => {
    const ran = [];
    /** @type {(step: { id: string }) => number} */
    const exec = (step) => {
      ran.push(step.id);
      return step.id === "test" ? 1 : 0;
    };
    const result = runSteps(STEPS, { exec, log: () => {} });
    expect(result.ok).toBe(false);
    expect(result.failed?.id).toBe("test");
    expect(ran).toEqual(["typecheck", "typecheck:electron", "test"]);
  });

  it("reports ok when every step exits 0", () => {
    const result = runSteps(STEPS, { exec: () => 0, log: () => {} });
    expect(result.ok).toBe(true);
    expect(result.failed).toBeUndefined();
  });
});
