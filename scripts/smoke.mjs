#!/usr/bin/env node
// @ts-check
// Release smoke test (PRD-05 §1.3 / §2.2, issue 032).
//
// Boots the BUILT server (packages/server/dist/server.js) — not the TS sources — and asserts the
// health probe answers 200 with the expected shape. This is the "it compiles but won't boot" net:
// a broken import path, a missing dist file, a route table that throws at mount time. None of that
// shows up in vitest (which runs the sources) or in `tsc` (which never executes anything).
//
// It boots twice, because the server has two boot modes and they wire different route tables:
//   1. setup mode   — no credentials: only setup + health, everything else 503s.
//   2. configured   — dummy credentials: the full table from app.ts mounts.
// The dummy credentials never reach YouTube (the background refresh fails offline and is ignored);
// what is being proven is that the credentialed boot path mounts and serves at all.
//
// The probe is GET /api/feedback/health — the canonical health route. PRD-05 §1.3 says "/health";
// that alias was dropped as dead code in issue 030 (it was shadowed), so the live one is used.
//
// Usage (from repo root, after `npm run build:all`): npm run smoke
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "packages", "server", "dist", "server.js");

/** The health states the server may legitimately report (mirrors healthStatusSchema). */
const HEALTH_STATES = ["ok", "degraded", "offline", "auth_error"];

/**
 * Checks a health body against the shape Companion and the dashboard rely on.
 * @param {unknown} body     Parsed JSON from GET /api/feedback/health.
 * @param {"setup" | "configured"} mode
 * @returns {string[]} human-readable problems; empty means the shape is good.
 */
export function checkHealthBody(body, mode) {
  /** @type {string[]} */
  const problems = [];
  if (typeof body !== "object" || body === null) return ["body is not a JSON object"];
  const b = /** @type {Record<string, unknown>} */ (body);

  if (typeof b.authenticated !== "boolean") problems.push("authenticated is not a boolean");
  if (typeof b.apiEnabled !== "boolean") problems.push("apiEnabled is not a boolean");

  if (mode === "setup") {
    // Setup mode must be distinguishable from "misconfigured", or the desktop app can't tell an
    // un-set-up install from a broken one (PRD-03 §2).
    if (b.status !== "setup_required") problems.push(`status is "${String(b.status)}", want "setup_required"`);
    if (b.setupRequired !== true) problems.push("setupRequired is not true");
    if (typeof b.message !== "string" || !b.message) problems.push("message is missing");
    return problems;
  }

  if (typeof b.status !== "string" || !HEALTH_STATES.includes(b.status)) {
    problems.push(`status "${String(b.status)}" is not one of ${HEALTH_STATES.join("|")}`);
  }
  // The quota budget drives the Companion quota feedback; a boot that can't report it is broken.
  for (const key of ["quotaUsed", "quotaLimit", "quotaRemaining"]) {
    if (typeof b[key] !== "number") problems.push(`${key} is not a number`);
  }
  return problems;
}

/** An OS-assigned free port, so a smoke run never collides with a dev server on 8080. */
async function freePort() {
  const srv = net.createServer();
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(undefined)));
  const { port } = /** @type {import("node:net").AddressInfo} */ (srv.address());
  await new Promise((resolve) => srv.close(() => resolve(undefined)));
  return port;
}

/** Polls until the server answers or the deadline passes. Boot is fast; this just avoids a race. */
async function waitForHealth(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      return { status: res.status, body: await res.json() };
    } catch (err) {
      if (Date.now() > deadline) throw new Error(`server never answered ${url}: ${err}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/**
 * Boots dist/server.js in `mode`, probes health, and asserts 200 + shape. The child runs with cwd
 * set to a throwaway data dir so dotenv can't pick up the developer's .env and quietly turn a
 * setup-mode boot into a configured one.
 * @param {"setup" | "configured"} mode
 * @param {(line: string) => void} log
 */
async function bootAndProbe(mode, log) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `smoke-${mode}-`));
  const port = await freePort();
  const creds =
    mode === "configured"
      ? { YT_CLIENT_ID: "smoke.apps", YT_CLIENT_SECRET: "smoke-secret", YT_REFRESH_TOKEN: "1//smoke" }
      : {};
  const child = spawn(process.execPath, [entry], {
    cwd: dir,
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, ...creds },
    stdio: ["ignore", "pipe", "pipe"],
  });
  /** @type {string[]} */
  const output = [];
  child.stdout.on("data", (d) => output.push(String(d)));
  child.stderr.on("data", (d) => output.push(String(d)));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
  // A server that dies on boot (the common failure) should report that immediately, rather than
  // making the poll loop wait out its full timeout on a port nothing will ever answer.
  const died = exited.then((code) => {
    throw new Error(`server exited with code ${code} before answering health`);
  });

  try {
    const probe = waitForHealth(`http://127.0.0.1:${port}/api/feedback/health`);
    const { status, body } = await Promise.race([probe, died]);
    if (status !== 200) throw new Error(`GET /api/feedback/health → ${status}, want 200`);
    const problems = checkHealthBody(body, mode);
    if (problems.length > 0) {
      throw new Error(`health body is wrong shape:\n  - ${problems.join("\n  - ")}\n  got: ${JSON.stringify(body)}`);
    }
    log(`✓ smoke (${mode}): booted and served health 200 — status "${body.status}"`);
  } catch (err) {
    log(`\n✗ smoke (${mode}) failed. Server output:\n${output.join("") || "(none)"}`);
    throw err;
  } finally {
    child.kill("SIGTERM");
    await exited;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** @param {(line: string) => void} [log] */
export async function smoke(log = (line) => console.log(line)) {
  await fs.access(entry).catch(() => {
    throw new Error(`no built server at ${entry} — run "npm run build:all" first`);
  });
  await bootAndProbe("setup", log);
  await bootAndProbe("configured", log);
}

// Entry point when run as a script (not when imported by the tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  smoke().then(
    () => process.exit(0),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
