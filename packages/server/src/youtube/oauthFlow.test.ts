import { describe, expect, it, vi } from "vitest";
import { runOAuthFlow, OAUTH_SCOPES } from "./oauthFlow.js";
import { AppError } from "../core/errors.js";

// A test port distinct from the real 53682 so the suite never fights a running app for the port.
const TEST_PORT = 53999;

/**
 * A fake googleapis OAuth2 client. Records the auth-url options it was asked for and returns a
 * canned token from getToken — no network, no real Google. `refreshToken` controls what the
 * exchange yields (undefined models Google's "already granted, no refresh token" case).
 */
function fakeOAuth(refreshToken: string | undefined) {
  const calls = { authOpts: null as unknown, code: null as string | null };
  const factory = (clientId: string, clientSecret: string, redirect: string) => ({
    clientId,
    clientSecret,
    redirect,
    generateAuthUrl(opts: { access_type: string; prompt: string; scope: string[] }) {
      calls.authOpts = opts;
      return `https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=${encodeURIComponent(redirect)}`;
    },
    async getToken(code: string) {
      calls.code = code;
      return { tokens: { refresh_token: refreshToken } };
    },
  });
  return { factory, calls };
}

/** Simulates the user completing consent: the system browser lands on the loopback redirect. */
function completeConsent(code = "auth-code-xyz", port = TEST_PORT) {
  return () => {
    void fetch(`http://localhost:${port}/oauth2callback?code=${code}`).catch(() => {});
  };
}

describe("runOAuthFlow", () => {
  it("opens the consent URL, catches the loopback code, and returns the refresh token", async () => {
    const { factory, calls } = fakeOAuth("rt-happy");
    const openBrowser = vi.fn(completeConsent());

    const result = await runOAuthFlow({
      clientId: "id",
      clientSecret: "secret",
      openBrowser,
      port: TEST_PORT,
      oauthFactory: factory,
    });

    expect(result).toEqual({ refreshToken: "rt-happy" });
    // Consent opened in the (system) browser, offline + forced consent, single youtube scope.
    expect(openBrowser).toHaveBeenCalledOnce();
    expect(calls.authOpts).toMatchObject({
      access_type: "offline",
      prompt: "consent",
      scope: OAUTH_SCOPES,
    });
    expect(calls.code).toBe("auth-code-xyz");
  });

  it("rejects with revoke-and-retry guidance when Google returns no refresh token", async () => {
    const { factory } = fakeOAuth(undefined); // already-granted: no refresh_token
    const openBrowser = vi.fn(completeConsent());

    const err = await runOAuthFlow({
      clientId: "id",
      clientSecret: "secret",
      openBrowser,
      port: TEST_PORT,
      oauthFactory: factory,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("OAUTH_NO_REFRESH_TOKEN");
    expect(err.message).toMatch(/myaccount\.google\.com\/permissions/);
  });

  it("rejects before opening the browser when credentials are missing", async () => {
    const openBrowser = vi.fn();
    const err = await runOAuthFlow({
      clientId: "",
      clientSecret: "secret",
      openBrowser,
      port: TEST_PORT,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("OAUTH_FAILED");
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("wraps a token-exchange failure as OAUTH_FAILED", async () => {
    const factory = () => ({
      generateAuthUrl: () => "https://accounts.google.com/consent",
      getToken: async () => {
        throw new Error("invalid_grant");
      },
    });
    const err = await runOAuthFlow({
      clientId: "id",
      clientSecret: "secret",
      openBrowser: completeConsent(),
      port: TEST_PORT,
      oauthFactory: factory,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("OAUTH_FAILED");
    expect(err.message).toMatch(/invalid_grant/);
  });

  it("ignores a callback with no code and still resolves on the real redirect", async () => {
    const { factory } = fakeOAuth("rt-late");
    // First hit the loopback with no code (a stray/favicon-style request), then the real code.
    const openBrowser = vi.fn(() => {
      void fetch(`http://localhost:${TEST_PORT}/oauth2callback`).then(() => {
        void fetch(`http://localhost:${TEST_PORT}/oauth2callback?code=real`).catch(() => {});
      });
    });

    const result = await runOAuthFlow({
      clientId: "id",
      clientSecret: "secret",
      openBrowser,
      port: TEST_PORT,
      oauthFactory: factory,
    });

    expect(result).toEqual({ refreshToken: "rt-late" });
  });
});
