import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { JsonStore } from "../storage/jsonStore.js";
import { setupRouter } from "./setup.js";

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
