import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

/**
 * Config is read once at boot, and two of its answers decide whether a hosted deployment is
 * guarded at all — so the failure modes worth testing are the ones that fail *open*.
 */

const KEYS = ["ADMIN_USERNAME", "ADMIN_PASSWORD", "TRUST_PROXY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const key of KEYS) delete process.env[key];
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("the admin seed", () => {
  it("is absent when neither variable is set — the desktop and LAN case", () => {
    expect(loadConfig().admin).toBeNull();
  });

  it("refuses to boot on half a seed rather than coming up with no accounts", () => {
    // The dangerous shape: a typo'd variable name used to yield authRequired=false, which on a
    // public host is an open server that looks deliberate.
    process.env.ADMIN_USERNAME = "operator";
    expect(() => loadConfig()).toThrow(/ADMIN_PASSWORD/);

    delete process.env.ADMIN_USERNAME;
    process.env.ADMIN_PASSWORD = "a-long-enough-secret";
    expect(() => loadConfig()).toThrow(/ADMIN_USERNAME/);
  });
});

describe("TRUST_PROXY", () => {
  it("trusts nobody unless asked", () => {
    expect(loadConfig().trustProxy).toBe(false);
  });

  it("reads a hop count as a number, and anything else as express's own vocabulary", () => {
    process.env.TRUST_PROXY = "1";
    expect(loadConfig().trustProxy).toBe(1);
    process.env.TRUST_PROXY = "true";
    expect(loadConfig().trustProxy).toBe(true);
    process.env.TRUST_PROXY = "loopback";
    expect(loadConfig().trustProxy).toBe("loopback");
  });
});
