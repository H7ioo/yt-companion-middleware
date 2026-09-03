import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

/**
 * Config is read once at boot, and two of its answers decide whether a hosted deployment is
 * guarded at all — so the failure modes worth testing are the ones that fail *open*.
 */

const KEYS = ["ADMIN_USERNAME", "ADMIN_PASSWORD", "TRUST_PROXY", "PUBLIC_ORIGIN"] as const;
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

/**
 * PUBLIC_ORIGIN is what makes the hosted connect flow possible (issue 052): it is the origin
 * Google redirects the admin's browser back to, and it must match the redirect URI registered on
 * the OAuth client character for character. A wrong value does not fail at boot — it fails at
 * consent, in a browser, with Google's own `redirect_uri_mismatch`, which is exactly the moment
 * nobody wants to be debugging. So the parsing is strict and the failures are loud.
 */
describe("PUBLIC_ORIGIN", () => {
  it("is empty unless set — the desktop, LAN and direct-Docker case", () => {
    expect(loadConfig().publicOrigin).toBe("");
  });

  it("keeps scheme, host and port, and drops a trailing slash", () => {
    process.env.PUBLIC_ORIGIN = "https://live.example.org/";
    expect(loadConfig().publicOrigin).toBe("https://live.example.org");
    process.env.PUBLIC_ORIGIN = "http://192.168.1.10:8080";
    expect(loadConfig().publicOrigin).toBe("http://192.168.1.10:8080");
  });

  it("refuses a value that is not an absolute http(s) origin", () => {
    // The shapes an operator actually types: a bare hostname, and an origin with a path on it.
    // Both would build a redirect URI that silently does not match the registered one.
    process.env.PUBLIC_ORIGIN = "live.example.org";
    expect(() => loadConfig()).toThrow(/PUBLIC_ORIGIN/);
    process.env.PUBLIC_ORIGIN = "https://live.example.org/app";
    expect(() => loadConfig()).toThrow(/PUBLIC_ORIGIN/);
    process.env.PUBLIC_ORIGIN = "ftp://live.example.org";
    expect(() => loadConfig()).toThrow(/PUBLIC_ORIGIN/);
  });
});
