import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import http from "node:http";
import { appInfoRouter, type AppInfoDeps, type UpdateHost } from "./appInfo.js";
import { parseChangelog } from "../core/changelog.js";

const changelog = parseChangelog(`## [2.2.0] - 2026-08-01

### Added

- **desktop:** auto-update

## [2.1.0] - 2026-07-10

### Fixed

- health probe 500
`);

/** Boots the router on an ephemeral port — same shape as the route integration tests. */
async function boot(deps: Partial<AppInfoDeps> = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/dashboard/app", appInfoRouter({ version: "2.1.0", changelog, ...deps }));
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  servers.push(server);
  return `http://127.0.0.1:${port}`;
}

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function call(url: string, method: "GET" | "POST" = "GET") {
  const res = await fetch(url, { method });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("GET /api/dashboard/app", () => {
  it("reports the running version with its own notes", async () => {
    const url = await boot();
    const { status, body } = await call(`${url}/api/dashboard/app`);
    expect(status).toBe(200);
    expect(body.version).toBe("2.1.0");
    expect(body.notes).toEqual({
      version: "2.1.0",
      date: "2026-07-10",
      sections: [{ title: "Fixed", items: ["health probe 500"] }],
    });
  });

  it("says updates are unsupported when the host has no updater (Docker, portable, dev)", async () => {
    const url = await boot();
    const { body } = await call(`${url}/api/dashboard/app`);
    expect(body.update).toEqual({ status: "unsupported" });
    expect(body.updateNotes).toBeNull();
  });

  it("surfaces the OFFERED version's notes from the update feed, not the bundled changelog (PRD-10 §3)", async () => {
    // The feed threads the offered version's notes onto the updater state; the app-info route
    // must prefer those — the bundled changelog cannot describe a version this build predates.
    const updates: UpdateHost = {
      getState: () => ({ status: "downloaded", version: "2.2.0", notes: "Streaming-safe auto-update." }),
      installAndRestart: () => true,
    };
    const url = await boot({ updates });
    const { body } = await call(`${url}/api/dashboard/app`);
    expect(body.update).toMatchObject({ status: "downloaded", version: "2.2.0" });
    expect(body.updateNotes).toBe("Streaming-safe auto-update.");
    expect(body.notes.version).toBe("2.1.0"); // still the running version's own notes
  });

  it("has no update notes when the feed carried none, even for a known changelog version", async () => {
    const updates: UpdateHost = {
      getState: () => ({ status: "downloaded", version: "2.2.0" }),
      installAndRestart: () => true,
    };
    const url = await boot({ updates });
    const { body } = await call(`${url}/api/dashboard/app`);
    expect(body.updateNotes).toBeNull();
  });

  it("returns null notes rather than the wrong ones when the changelog has no such version", async () => {
    const url = await boot({ version: "9.9.9" });
    const { body } = await call(`${url}/api/dashboard/app`);
    expect(body.notes).toBeNull();
  });
});

describe("POST /api/dashboard/app/update/install", () => {
  it("installs when an update is staged", async () => {
    const installAndRestart = vi.fn(() => true);
    const updates: UpdateHost = {
      getState: () => ({ status: "downloaded", version: "2.2.0" }),
      installAndRestart,
    };
    const url = await boot({ updates });
    const { status } = await call(`${url}/api/dashboard/app/update/install`, "POST");
    expect(status).toBe(202);
    expect(installAndRestart).toHaveBeenCalledTimes(1);
  });

  it("refuses when nothing is staged — never a no-op restart", async () => {
    const updates: UpdateHost = {
      getState: () => ({ status: "checking" }),
      installAndRestart: () => false,
    };
    const url = await boot({ updates });
    const { status, body } = await call(`${url}/api/dashboard/app/update/install`, "POST");
    expect(status).toBe(409);
    expect(body.error).toMatch(/no update is staged/i);
  });

  it("refuses on a host with no updater at all", async () => {
    const url = await boot();
    const { status, body } = await call(`${url}/api/dashboard/app/update/install`, "POST");
    expect(status).toBe(409);
    expect(body.error).toMatch(/does not update itself/i);
  });
});
