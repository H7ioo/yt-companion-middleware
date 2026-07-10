// @ts-check
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderOAuthConfig, writeOAuthConfig } from "./gen-oauth-config.mjs";

describe("renderOAuthConfig", () => {
  it("embeds the client id/secret and flags the bundled client present", () => {
    const src = renderOAuthConfig({ clientId: "abc.apps.googleusercontent.com", clientSecret: "s3cr3t" });
    expect(src).toContain('export const BUNDLED_CLIENT_ID = "abc.apps.googleusercontent.com"');
    expect(src).toContain('export const BUNDLED_CLIENT_SECRET = "s3cr3t"');
    expect(src).toContain("export const HAS_BUNDLED_CLIENT = true");
  });

  it("emits empty constants and HAS_BUNDLED_CLIENT=false when creds are missing", () => {
    const src = renderOAuthConfig();
    expect(src).toContain('export const BUNDLED_CLIENT_ID = ""');
    expect(src).toContain('export const BUNDLED_CLIENT_SECRET = ""');
    expect(src).toContain("export const HAS_BUNDLED_CLIENT = false");
  });

  it("flags absent when only one of id/secret is present", () => {
    expect(renderOAuthConfig({ clientId: "abc" })).toContain("export const HAS_BUNDLED_CLIENT = false");
  });

  it("escapes quotes so a value cannot break out of the string literal", () => {
    const src = renderOAuthConfig({ clientId: 'ev"il', clientSecret: "x" });
    expect(src).toContain('export const BUNDLED_CLIENT_ID = "ev\\"il"');
  });
});

describe("writeOAuthConfig", () => {
  it("writes an importable module carrying the CI env values", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-cfg-"));
    const env = { YT_BUNDLED_CLIENT_ID: "id-123", YT_BUNDLED_CLIENT_SECRET: "sec-456" };
    const written = writeOAuthConfig(env, dir);
    expect(fs.existsSync(written)).toBe(true);
    const mod = await import(`file://${written}`);
    expect(mod.BUNDLED_CLIENT_ID).toBe("id-123");
    expect(mod.BUNDLED_CLIENT_SECRET).toBe("sec-456");
    expect(mod.HAS_BUNDLED_CLIENT).toBe(true);
  });

  it("writes empty constants (no crash) when env is absent", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-cfg-"));
    const written = writeOAuthConfig({}, dir);
    const mod = await import(`file://${written}`);
    expect(mod.BUNDLED_CLIENT_ID).toBe("");
    expect(mod.HAS_BUNDLED_CLIENT).toBe(false);
  });
});
