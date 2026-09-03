import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { JsonStore } from "../storage/jsonStore.js";
import { setupRouter } from "./setup.js";
import { AppError } from "../core/errors.js";
import { OAUTH_REDIRECT } from "../youtube/oauthFlow.js";

/** Boots the setup router on an ephemeral port and returns its base URL + a teardown. */
async function mount(deps: Parameters<typeof setupRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use("/api/setup", setupRouter(deps));
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("setup route", () => {
  let store: JsonStore;
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "setup-route-"));
    store = new JsonStore(path.join(dir, "store.json"));
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reports activeFlow: override for a stored client that isn't the bundled one", async () => {
    await store.update((s) => {
      s.credentials = { clientId: "mine.apps", clientSecret: "sec", refreshToken: "1//x" };
    });
    const { url, close } = await mount({
      store,
      configured: true,
      requestRestart: () => {},
      oauth: { hasBundledClient: true, bundledClientId: "bundled.apps", run: async () => {} },
    });
    try {
      const res = await fetch(`${url}/api/setup/status`);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.activeFlow).toBe("override");
      // Secrets never leave the server — only booleans and the flow.
      expect(body).not.toHaveProperty("clientSecret");
      expect(body).not.toHaveProperty("refreshToken");
      expect(body.hasRefreshToken).toBe(true);
    } finally {
      await close();
    }
  });

  it("disconnect clears stored credentials and asks the server to restart", async () => {
    await store.update((s) => {
      s.credentials = { clientId: "mine.apps", clientSecret: "sec", refreshToken: "1//x" };
    });
    let restarted = false;
    const { url, close } = await mount({
      store,
      configured: true,
      requestRestart: () => {
        restarted = true;
      },
    });
    try {
      const res = await fetch(`${url}/api/setup/disconnect`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(store.get().credentials).toEqual({ clientId: "", clientSecret: "", refreshToken: "" });
      expect(restarted).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("setup status and channel eligibility (issue 061)", () => {
  let store: JsonStore;
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "setup-elig-"));
    store = new JsonStore(path.join(dir, "store.json"));
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  // Setup status, not health: PRD-16 §6 is explicit that riding mode belongs beside "which
  // channel are we connected to", never beside "can we reach YouTube".
  it("reports riding mode with YouTube's own reason", async () => {
    await store.update((s) => {
      s.liveEligibility = {
        mode: "riding",
        reason: "insufficientLivePermissions",
        message: "The user is not enabled for live streaming.",
        checkedAt: "2026-09-03T10:00:00.000Z",
      };
    });
    const { url, close } = await mount({ store, configured: true, requestRestart: () => {} });
    try {
      const body = (await (await fetch(`${url}/api/setup/status`)).json()) as Record<string, unknown>;
      expect(body.liveEligibility).toEqual({
        mode: "riding",
        reason: "insufficientLivePermissions",
        message: "The user is not enabled for live streaming.",
        checkedAt: "2026-09-03T10:00:00.000Z",
      });
    } finally {
      await close();
    }
  });

  it("reports unknown before anything has been refused", async () => {
    const { url, close } = await mount({ store, configured: true, requestRestart: () => {} });
    try {
      const body = (await (await fetch(`${url}/api/setup/status`)).json()) as {
        liveEligibility: { mode: string };
      };
      expect(body.liveEligibility.mode).toBe("unknown");
    } finally {
      await close();
    }
  });

  // The credential POST is the only way onto a headless host, where `connectYouTube` — and so its
  // reset — never runs. Without this, channel A's refusal would disable creation on channel B.
  it("forgets riding mode when credentials are replaced", async () => {
    await store.update((s) => {
      s.liveEligibility = {
        mode: "riding",
        reason: "livePermissionBlocked",
        message: "no",
        checkedAt: "2026-09-01T00:00:00.000Z",
      };
    });
    const { url, close } = await mount({ store, configured: true, requestRestart: () => {} });
    try {
      const res = await fetch(`${url}/api/setup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: "b.apps", clientSecret: "sec", refreshToken: "1//b" }),
      });
      expect(res.status).toBe(200);
      expect(store.get().liveEligibility.mode).toBe("unknown");
    } finally {
      await close();
    }
  });

  it("forgets riding mode on disconnect — the next connect may be another channel", async () => {
    await store.update((s) => {
      s.liveEligibility = {
        mode: "riding",
        reason: "livePermissionBlocked",
        message: "no",
        checkedAt: "2026-09-01T00:00:00.000Z",
      };
    });
    const { url, close } = await mount({ store, configured: true, requestRestart: () => {} });
    try {
      await fetch(`${url}/api/setup/disconnect`, { method: "POST" });
      expect(store.get().liveEligibility.mode).toBe("unknown");
    } finally {
      await close();
    }
  });
});

/**
 * The hosted connect flow's two endpoints (issue 052). The module itself is tested in
 * `youtube/hostedOAuth.test.ts`; what matters here is the HTTP shape — that starting the flow
 * returns a URL and nothing else, and that the callback, which is a *browser navigation* and not
 * a fetch, answers with a redirect an admin can read rather than a JSON body they cannot.
 */
describe("hosted connect endpoints (issue 052)", () => {
  let store: JsonStore;
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "hosted-setup-"));
    store = new JsonStore(path.join(dir, "store.json"));
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const hosted = (over: Partial<NonNullable<Parameters<typeof setupRouter>[0]["hosted"]>> = {}) => ({
    redirectUri: "https://live.example.org/api/setup/oauth/callback",
    authorize: () => ({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc" }),
    complete: async () => {},
    ...over,
  });

  it("hands back the consent URL to visit, and nothing else", async () => {
    const { url, close } = await mount({
      store,
      configured: false,
      requestRestart: () => {},
      hosted: hosted(),
    });
    try {
      const res = await fetch(`${url}/api/setup/oauth/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(200);
      expect(body.url).toMatch(/^https:\/\/accounts\.google\.com\//);
      expect(Object.keys(body)).toEqual(["url"]);
    } finally {
      await close();
    }
  });

  it("passes the operator's own client through to the flow", async () => {
    let seen: unknown = null;
    const { url, close } = await mount({
      store,
      configured: false,
      requestRestart: () => {},
      hosted: hosted({
        authorize: (override) => {
          seen = override;
          return { url: "https://accounts.google.com/o/oauth2/v2/auth" };
        },
      }),
    });
    try {
      await fetch(`${url}/api/setup/oauth/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "mine.apps", clientSecret: "mine-secret" }),
      });
      expect(seen).toEqual({ clientId: "mine.apps", clientSecret: "mine-secret" });
    } finally {
      await close();
    }
  });

  it("reports the flow unavailable where it cannot run", async () => {
    // No public origin configured: the desktop and LAN case. A 501 rather than a 404, so the
    // dashboard can tell "this build does not do that" from "that route is gone".
    const { url, close } = await mount({ store, configured: false, requestRestart: () => {} });
    try {
      const res = await fetch(`${url}/api/setup/oauth/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(501);
    } finally {
      await close();
    }
  });

  it("sends the returning browser back to the dashboard, not to a JSON body", async () => {
    let seen: unknown = null;
    const { url, close } = await mount({
      store,
      configured: false,
      requestRestart: () => {},
      hosted: hosted({
        complete: async (params) => {
          seen = params;
        },
      }),
    });
    try {
      const res = await fetch(`${url}/api/setup/oauth/callback?code=abc&state=xyz`, {
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/?connected=youtube");
      expect(seen).toEqual({ code: "abc", state: "xyz", error: undefined });
    } finally {
      await close();
    }
  });

  it("carries a failure back in the redirect, where the person who clicked can read it", async () => {
    const { url, close } = await mount({
      store,
      configured: false,
      requestRestart: () => {},
      hosted: hosted({
        complete: async () => {
          throw new AppError("OAUTH_NO_REFRESH_TOKEN");
        },
      }),
    });
    try {
      const res = await fetch(`${url}/api/setup/oauth/callback?code=abc&state=xyz`, {
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("location")!, "http://x");
      expect(location.pathname).toBe("/");
      expect(location.searchParams.get("connect_error")).toMatch(/refresh token/i);
    } finally {
      await close();
    }
  });

  it("reports the hosted redirect URI to register, and a redirect connect mode", async () => {
    const { url, close } = await mount({
      store,
      configured: false,
      requestRestart: () => {},
      hosted: hosted(),
    });
    try {
      const body = (await (await fetch(`${url}/api/setup/status`)).json()) as Record<string, unknown>;
      // This is the string that has to be pasted into the Google client, character for character.
      expect(body.redirectUri).toBe("https://live.example.org/api/setup/oauth/callback");
      expect(body.connectMode).toBe("redirect");
    } finally {
      await close();
    }
  });

  it("still calls the desktop flow in-app, and reports no connect mode with neither", async () => {
    const { url, close } = await mount({
      store,
      configured: false,
      requestRestart: () => {},
      oauth: { hasBundledClient: true, run: async () => {} },
    });
    try {
      const body = (await (await fetch(`${url}/api/setup/status`)).json()) as Record<string, unknown>;
      expect(body.connectMode).toBe("in-app");
      expect(body.redirectUri).toBe(OAUTH_REDIRECT);
    } finally {
      await close();
    }

    const bare = await mount({ store, configured: false, requestRestart: () => {} });
    try {
      const body = (await (await fetch(`${bare.url}/api/setup/status`)).json()) as Record<string, unknown>;
      expect(body.connectMode).toBeNull();
    } finally {
      await bare.close();
    }
  });
});
