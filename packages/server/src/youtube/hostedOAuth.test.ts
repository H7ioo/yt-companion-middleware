import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { JsonStore } from "../storage/jsonStore.js";
import type { CredentialsState } from "../storage/schema.js";
import { AppError } from "../core/errors.js";
import { HostedOAuth, hostedRedirectUri, HOSTED_CALLBACK_PATH } from "./hostedOAuth.js";
import type { OAuthClientFactory } from "./oauthFlow.js";

/**
 * The hosted connect flow (issue 052). The loopback flow in `oauthFlow.ts` cannot run here: a
 * headless host has no browser to open and no loopback the admin's browser can reach. Consent
 * instead happens in the admin's own browser and Google redirects back to the public origin, so
 * the two things this module has to get right are the ones the loopback flow got for free —
 * **which** browser is coming back, and **that it is the one we sent**.
 */

/** A fake Google client: records what it was asked, and answers with a scripted token. */
function fakeFactory(script: {
  refreshToken?: string | null;
  throws?: Error;
}): { factory: OAuthClientFactory; seen: { redirect?: string; url?: string; codes: string[]; clientId?: string; clientSecret?: string } } {
  const seen: { redirect?: string; url?: string; codes: string[]; clientId?: string; clientSecret?: string } = {
    codes: [],
  };
  const factory: OAuthClientFactory = (clientId, clientSecret, redirect) => {
    seen.clientId = clientId;
    seen.clientSecret = clientSecret;
    seen.redirect = redirect;
    return {
      generateAuthUrl: (opts) => {
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("redirect_uri", redirect);
        url.searchParams.set("access_type", opts.access_type);
        url.searchParams.set("prompt", opts.prompt);
        url.searchParams.set("scope", opts.scope.join(" "));
        if (opts.state) url.searchParams.set("state", opts.state);
        seen.url = url.toString();
        return url.toString();
      },
      getToken: async (code) => {
        seen.codes.push(code);
        if (script.throws) throw script.throws;
        return { tokens: { refresh_token: script.refreshToken ?? null } };
      },
    };
  };
  return { factory, seen };
}

const ORIGIN = "https://live.example.org";

describe("the hosted connect flow", () => {
  let store: JsonStore;
  let dir: string;
  let applied: CredentialsState[];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "hosted-oauth-"));
    store = new JsonStore(path.join(dir, "store.json"));
    await store.init();
    applied = [];
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const build = (
    factory: OAuthClientFactory,
    extra: { bundledClient?: { clientId: string; clientSecret: string }; ttlMs?: number; now?: () => number } = {},
  ) =>
    new HostedOAuth({
      store,
      publicOrigin: ORIGIN,
      applyCredentials: (c) => {
        applied.push(c);
      },
      oauthFactory: factory,
      ...extra,
    });

  it("sends the admin to Google with the public callback as the redirect", () => {
    const { factory, seen } = fakeFactory({ refreshToken: "1//new" });
    const oauth = build(factory, { bundledClient: { clientId: "bundled.apps", clientSecret: "s" } });

    const { url } = oauth.authorize();

    const params = new URL(url).searchParams;
    expect(seen.redirect).toBe(`${ORIGIN}${HOSTED_CALLBACK_PATH}`);
    expect(params.get("redirect_uri")).toBe(hostedRedirectUri(ORIGIN));
    // Without offline access + a forced consent screen Google hands back no refresh token, and
    // a hosted deployment has no second chance to ask for one.
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent");
    expect(params.get("scope")).toBe("https://www.googleapis.com/auth/youtube");
    expect(params.get("state")).toMatch(/^[0-9a-f]{32,}$/);
  });

  it("prefers a just-entered override client over the stored and bundled ones", async () => {
    await store.update((s) => {
      s.credentials = { clientId: "stored.apps", clientSecret: "stored-secret", refreshToken: "" };
    });
    const { factory, seen } = fakeFactory({ refreshToken: "1//new" });
    const oauth = build(factory, { bundledClient: { clientId: "bundled.apps", clientSecret: "b" } });

    oauth.authorize({ clientId: "mine.apps", clientSecret: "mine-secret" });

    expect(seen.clientId).toBe("mine.apps");
    expect(seen.clientSecret).toBe("mine-secret");
  });

  it("refuses to start with no OAuth client at all", () => {
    const { factory } = fakeFactory({ refreshToken: "1//new" });
    // A headless deployment ships no bundled client, so this is the first-run shape, not an edge
    // case: the admin has to supply their own before there is anything to consent to.
    expect(() => build(factory).authorize()).toThrow(AppError);
  });

  it("stores the refresh token and rebuilds the client in-process, with no restart", async () => {
    await store.update((s) => {
      s.credentials = { clientId: "stored.apps", clientSecret: "stored-secret", refreshToken: "" };
    });
    const { factory } = fakeFactory({ refreshToken: "1//fresh" });
    const oauth = build(factory);

    const { url } = oauth.authorize();
    const state = new URL(url).searchParams.get("state")!;
    await oauth.complete({ code: "auth-code", state });

    expect(store.get().credentials).toEqual({
      clientId: "stored.apps",
      clientSecret: "stored-secret",
      refreshToken: "1//fresh",
    });
    expect(applied).toHaveLength(1);
    expect(applied[0].refreshToken).toBe("1//fresh");
  });

  it("never hands the refresh token back to its caller", async () => {
    const { factory } = fakeFactory({ refreshToken: "1//fresh" });
    const oauth = build(factory, { bundledClient: { clientId: "b.apps", clientSecret: "b" } });
    const state = new URL(oauth.authorize().url).searchParams.get("state")!;

    // The callback is a browser-facing endpoint. `complete` resolving with nothing is what keeps
    // the token from ever having a route out.
    await expect(oauth.complete({ code: "auth-code", state })).resolves.toBeUndefined();
  });

  it("forgets what YouTube refused the previous channel", async () => {
    await store.update((s) => {
      s.credentials = { clientId: "c.apps", clientSecret: "sec", refreshToken: "1//old" };
      s.liveEligibility = {
        mode: "riding",
        reason: "livePermissionBlocked",
        message: "The channel is not eligible.",
        checkedAt: "2026-09-01T00:00:00.000Z",
      };
    });
    const { factory } = fakeFactory({ refreshToken: "1//fresh" });
    const oauth = build(factory);
    const state = new URL(oauth.authorize().url).searchParams.get("state")!;

    await oauth.complete({ code: "auth-code", state });

    // The reconnect may well be to a different channel, and carrying the refusal over would
    // disable broadcast creation on a channel that has never refused anything (issue 061).
    expect(store.get().liveEligibility.mode).toBe("unknown");
  });

  describe("guarding the callback", () => {
    it("refuses a callback whose state it never issued", async () => {
      const { factory, seen } = fakeFactory({ refreshToken: "1//attacker" });
      const oauth = build(factory, { bundledClient: { clientId: "b.apps", clientSecret: "b" } });
      oauth.authorize();

      await expect(oauth.complete({ code: "planted", state: "not-ours" })).rejects.toThrow(AppError);
      // The point is not the refusal but what did not happen: no exchange, so a code someone
      // else planted can never become this deployment's channel.
      expect(seen.codes).toEqual([]);
      expect(store.get().credentials.refreshToken).toBe("");
    });

    it("refuses a callback carrying no state at all", async () => {
      const { factory } = fakeFactory({ refreshToken: "1//x" });
      const oauth = build(factory, { bundledClient: { clientId: "b.apps", clientSecret: "b" } });
      oauth.authorize();
      await expect(oauth.complete({ code: "planted" })).rejects.toThrow(AppError);
    });

    it("spends a state once — a replayed callback is refused", async () => {
      const { factory } = fakeFactory({ refreshToken: "1//fresh" });
      const oauth = build(factory, { bundledClient: { clientId: "b.apps", clientSecret: "b" } });
      const state = new URL(oauth.authorize().url).searchParams.get("state")!;

      await oauth.complete({ code: "auth-code", state });
      await expect(oauth.complete({ code: "auth-code", state })).rejects.toThrow(AppError);
    });

    it("refuses a state that has gone stale", async () => {
      const { factory } = fakeFactory({ refreshToken: "1//fresh" });
      let clock = 0;
      const oauth = build(factory, {
        bundledClient: { clientId: "b.apps", clientSecret: "b" },
        ttlMs: 1000,
        now: () => clock,
      });
      const state = new URL(oauth.authorize().url).searchParams.get("state")!;

      clock = 1001;
      await expect(oauth.complete({ code: "auth-code", state })).rejects.toThrow(/expired|start/i);
    });

    it("reports Google's own refusal when the admin declines consent", async () => {
      const { factory } = fakeFactory({ refreshToken: "1//fresh" });
      const oauth = build(factory, { bundledClient: { clientId: "b.apps", clientSecret: "b" } });
      const state = new URL(oauth.authorize().url).searchParams.get("state")!;

      await expect(oauth.complete({ state, error: "access_denied" })).rejects.toThrow(
        /access_denied/,
      );
      expect(store.get().credentials.refreshToken).toBe("");
    });

    it("gives the revoke-and-retry guidance when Google returns no refresh token", async () => {
      const { factory } = fakeFactory({ refreshToken: null });
      const oauth = build(factory, { bundledClient: { clientId: "b.apps", clientSecret: "b" } });
      const state = new URL(oauth.authorize().url).searchParams.get("state")!;

      await expect(oauth.complete({ code: "auth-code", state })).rejects.toMatchObject({
        code: "OAUTH_NO_REFRESH_TOKEN",
      });
      // Nothing half-written: a connect that produced no token must leave the previous one alone.
      expect(store.get().credentials.refreshToken).toBe("");
    });

    it("does not let unfinished attempts pile up without bound", () => {
      const { factory } = fakeFactory({ refreshToken: "1//x" });
      const oauth = build(factory, { bundledClient: { clientId: "b.apps", clientSecret: "b" } });
      // Every started-and-abandoned attempt holds a client secret in memory. A button that can be
      // clicked is a button that will be clicked a hundred times.
      const first = new URL(oauth.authorize().url).searchParams.get("state")!;
      for (let i = 0; i < 40; i++) oauth.authorize();
      expect(oauth.pendingCount).toBeLessThanOrEqual(16);
      expect(oauth.pendingCount).toBeGreaterThan(0);
      // The oldest is the one dropped, so the most recent click still works.
      expect(() => oauth.complete({ code: "c", state: first })).not.toBe(undefined);
    });
  });
});
