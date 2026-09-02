import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AuditLog, RETENTION_DAYS, describeAction, redact } from "./log.js";
import { forgetSecrets, rememberSecret } from "../core/secrets.js";

/**
 * The durable audit log (issue 050, PRD-15 §3). Three properties carry the whole slice: it
 * survives a restart, it forgets on a schedule, and it never writes a secret down.
 */

const DAY = 24 * 60 * 60 * 1000;
const person = { kind: "person" as const, id: "acc-1", name: "operator" };

let dir: string;
let now: number;
const at = (t = now) => new Date(t).toISOString();

function open(file = "audit.log"): AuditLog {
  return new AuditLog(path.join(dir, file), { now: () => now });
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-"));
  now = Date.UTC(2026, 7, 31);
});
afterEach(async () => {
  vi.restoreAllMocks();
  forgetSecrets();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("writing and reading entries", () => {
  it("records who, what, which target, what happened and when", async () => {
    const log = open();
    await log.append({
      actor: person,
      method: "PUT",
      path: "/api/dashboard/people/acc-2/role",
      status: 200,
      body: { role: "admin" },
    });

    const [entry] = await log.list();
    expect(entry.actor).toEqual(person);
    expect(entry.action).toBe("changed a role");
    expect(entry.target).toBe("acc-2");
    expect(entry.outcome).toBe("ok");
    expect(entry.status).toBe(200);
    expect(entry.ts).toBe(at());
    expect(entry.notable).toBe(true);
  });

  it("lists newest first", async () => {
    const log = open();
    await log.append({ actor: person, method: "POST", path: "/api/action/refresh", status: 200 });
    now += 1000;
    await log.append({ actor: person, method: "POST", path: "/api/action/undo", status: 200 });

    expect((await log.list()).map((e) => e.path)).toEqual([
      "/api/action/undo",
      "/api/action/refresh",
    ]);
  });

  it("survives a process restart", async () => {
    const first = open();
    await first.append({ actor: person, method: "DELETE", path: "/api/dashboard/people/acc-2", status: 200 });

    // A second instance over the same file is what a restart looks like from here.
    const second = open();
    const entries = await second.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("removed an account");
  });

  it("gives every entry an id of its own, even within the same millisecond", async () => {
    const log = open();
    await log.append({ actor: person, method: "POST", path: "/api/action/undo", status: 200 });
    await log.append({ actor: person, method: "POST", path: "/api/action/undo", status: 200 });
    const ids = (await log.list()).map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("names a machine by its token name rather than 'unknown'", async () => {
    const log = open();
    await log.append({
      actor: { kind: "machine", id: "dev-1", name: "companion machine" },
      method: "POST",
      path: "/api/action/preset",
      status: 200,
    });
    const [entry] = await log.list();
    expect(entry.actor.name).toBe("companion machine");
    expect(entry.actor.kind).toBe("machine");
  });

  it("reports a refusal and a failure as such", async () => {
    const log = open();
    await log.append({ actor: person, method: "DELETE", path: "/api/dashboard/people/acc-2", status: 403 });
    now += 1;
    await log.append({ actor: person, method: "PUT", path: "/api/dashboard/settings", status: 500 });
    expect((await log.list()).map((e) => e.outcome)).toEqual(["failed", "refused"]);
  });

  it("keeps the new stream binding, so a change of it can be answered for (issue 051)", async () => {
    const log = open();
    await log.append({
      actor: person,
      method: "PUT",
      path: "/api/dashboard/settings",
      status: 200,
      body: { defaultCategory: "20", defaultStreamBoundId: "stream-B" },
    });
    const [entry] = await log.list();
    expect(entry.action).toBe("changed the settings");
    // The confirmation in the dashboard stops a mis-click; this is what answers "who repointed
    // it, and to what" a week later, when the show has already gone nowhere.
    expect(entry.detail).toMatchObject({ defaultStreamBoundId: "stream-B" });
  });

  it("survives a corrupt line rather than losing the whole log", async () => {
    const log = open();
    await log.append({ actor: person, method: "POST", path: "/api/action/undo", status: 200 });
    // A half-written line is what a crash mid-append leaves behind.
    await fs.appendFile(path.join(dir, "audit.log"), '{"id":"broken"\n', "utf8");
    expect(await log.list()).toHaveLength(1);
  });

  it("answers with nothing at all before anything has been written", async () => {
    expect(await open().list()).toEqual([]);
  });
});

describe("retention", () => {
  it("trims entries older than the window and keeps the rest", async () => {
    const log = open();
    await log.append({ actor: person, method: "POST", path: "/api/action/undo", status: 200 });
    now += (RETENTION_DAYS + 1) * DAY;
    await log.append({ actor: person, method: "POST", path: "/api/action/refresh", status: 200 });

    const entries = await log.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("/api/action/refresh");
  });

  it("writes the trim to disk, so the file cannot grow without bound", async () => {
    const log = open();
    await log.append({ actor: person, method: "POST", path: "/api/action/undo", status: 200 });
    now += (RETENTION_DAYS + 1) * DAY;
    await log.append({ actor: person, method: "POST", path: "/api/action/refresh", status: 200 });

    const raw = await fs.readFile(path.join(dir, "audit.log"), "utf8");
    expect(raw.trim().split("\n")).toHaveLength(1);
  });

  it("keeps an entry that is inside the window", async () => {
    const log = open();
    await log.append({ actor: person, method: "POST", path: "/api/action/undo", status: 200 });
    now += (RETENTION_DAYS - 1) * DAY;
    await log.append({ actor: person, method: "POST", path: "/api/action/refresh", status: 200 });
    expect(await log.list()).toHaveLength(2);
  });
});

describe("redaction", () => {
  it("replaces a secret-shaped value wherever it sits", () => {
    const out = redact({
      clientId: "1234.apps.googleusercontent.com",
      clientSecret: "GOCSPX-super-secret",
      password: "hunter2",
      token: "yt_abc123",
      nested: { refreshToken: "1//0abc", title: "Sunday service" },
    });
    expect(JSON.stringify(out)).not.toContain("GOCSPX");
    expect(JSON.stringify(out)).not.toContain("hunter2");
    expect(JSON.stringify(out)).not.toContain("yt_abc123");
    expect(JSON.stringify(out)).not.toContain("1//0abc");
    // The harmless half is still there, or the log explains nothing.
    expect(out.clientId).toBe("1234.apps.googleusercontent.com");
    expect((out.nested as Record<string, unknown>).title).toBe("Sunday service");
  });

  it("keeps a runaway payload from becoming the log", () => {
    const out = redact({ title: "x".repeat(5000) });
    expect(String(out.title).length).toBeLessThan(500);
  });

  it("masks an endpoint down to its host, because the URL is the credential", () => {
    // `PUT /api/dashboard/webhook` carries `{url}`, and anyone holding that URL can drive the
    // notification. The host answers "pointed where"; the path and query are the secret half.
    const out = redact({ url: "https://hooks.example.test/t/abc-secret-topic?key=zzz" });
    expect(JSON.stringify(out)).not.toContain("abc-secret-topic");
    expect(JSON.stringify(out)).not.toContain("zzz");
    expect(out.url).toBe("https://hooks.example.test/…");
    expect(redact({ ntfyUrl: "https://ntfy.sh" }).ntfyUrl).toBe("https://ntfy.sh");
    // Cleared, not set: an empty value is not a secret, and "" is how the routes clear one.
    expect(redact({ url: "" }).url).toBe("");
  });

  it("does not recurse forever on a cyclic body", () => {
    const body: Record<string, unknown> = { title: "ok" };
    body.self = body;
    expect(() => redact(body)).not.toThrow();
  });
});

describe("what an entry is called", () => {
  it("names the account and role changes a person will come looking for", () => {
    expect(describeAction("PUT", "/api/dashboard/people/acc-2/role")).toMatchObject({
      action: "changed a role",
      target: "acc-2",
      notable: true,
    });
    expect(describeAction("POST", "/api/dashboard/people/invites")).toMatchObject({
      action: "created an invite",
      notable: true,
    });
    expect(describeAction("DELETE", "/api/dashboard/devices/dev-1")).toMatchObject({
      action: "revoked a device token",
      target: "dev-1",
      notable: true,
    });
    expect(describeAction("POST", "/api/setup/disconnect")).toMatchObject({
      action: "disconnected YouTube",
      notable: true,
    });
  });

  it("names a route however the caller cased it", () => {
    // Express routes case-insensitively by default, so `/API/Dashboard/...` reaches the same
    // handler. An audit log that only recognises one casing is one a caller can step around.
    expect(describeAction("put", "/API/Dashboard/people/acc-2/role")).toMatchObject({
      action: "changed a role",
      target: "acc-2",
      notable: true,
    });
  });

  it("does not mistake the invites collection for an account id", () => {
    // `/people/invites` and `/people/:id` are the same shape; matching in the wrong order would
    // record "cancelled an invite" as "removed an account".
    expect(describeAction("DELETE", "/api/dashboard/people/invites/inv-1")).toMatchObject({
      action: "cancelled an invite",
      target: "inv-1",
    });
  });

  it("marks running the show as routine", () => {
    const preset = describeAction("POST", "/api/action/preset");
    expect(preset.notable).toBe(false);
    expect(preset.action).toBe("ran a preset");
  });

  it("falls back to the bare request rather than inventing a name", () => {
    expect(describeAction("PUT", "/api/dashboard/webhook")).toMatchObject({
      action: "PUT /api/dashboard/webhook",
      target: null,
      notable: false,
    });
  });
});

// Issue 067: the audit log lives in the data directory beside store.json, and it names people and
// the things they did. It is not the refresh token, but it is not public either, and the directory
// it shares with the store must not be widened by the log's own mkdir.
describe.skipIf(process.platform === "win32")("file permissions", () => {
  it("creates its directory 0700 and its file 0600", async () => {
    const nested = path.join(dir, "data");
    const log = new AuditLog(path.join(nested, "audit.log"), { now: () => now });
    await log.append({ actor: person, method: "POST", path: "/api/auth/login", status: 200 });
    await log.settled();

    expect(((await fs.stat(nested)).mode & 0o777).toString(8)).toBe("700");
    expect(((await fs.stat(log.path)).mode & 0o777).toString(8)).toBe("600");
  });
});

// Issue 067: redaction by key covers a body whose shape is known. A live credential value can still
// arrive under a key nobody thought to name — echoed back inside a message, pasted into a field —
// and the audit log is on disk for ninety days.
describe("credential values, whatever key they arrive under", () => {
  it("never writes a live credential down, even under an innocent key", () => {
    forgetSecrets();
    rememberSecret("1//a-live-refresh-token");
    const out = redact({ note: "reconnect failed for 1//a-live-refresh-token" });
    expect(out.note).toBe("reconnect failed for [redacted]");
    forgetSecrets();
  });
});

// Issue 067 follow-up. `tighten` warns on a mount this process cannot chmod, and the mode work
// used to sit in the per-append path — so on such a mount that is two console lines for every cue
// of the evening, burying the log in exactly the situation the operator most needs to read it.
describe.skipIf(process.platform === "win32")("permission work on a mount we do not own", () => {
  it("complains once, not once per audited request", async () => {
    const log = open();
    vi.spyOn(fs, "chmod").mockRejectedValue(Object.assign(new Error("EPERM"), { code: "EPERM" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let i = 0; i < 5; i++) {
      await log.append({ actor: person, method: "POST", path: "/api/action/go-live", status: 200 });
    }
    await log.settled();

    // Two paths get tightened — the directory and the file — and each is worth saying once.
    expect(warn.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

// Issue 067 follow-up. Scrubbing on the write path only protects entries this build wrote. A log
// carried over from before that change — or written in the window where the scrubber had not yet
// been told the live token — still holds the plaintext, and retention keeps it for ninety days.
describe("a credential already on disk", () => {
  it("does not serve a plaintext token to the audit viewer", async () => {
    const token = "1//a-live-refresh-token";
    // Written the way a previous version did: no scrubber registered, so it lands in the clear.
    forgetSecrets();
    const log = open();
    await log.append({
      actor: person,
      method: "POST",
      path: "/api/setup/credentials",
      status: 200,
      body: { note: `reconnect failed for ${token}` },
    });
    await log.settled();
    expect(await fs.readFile(log.path, "utf8")).toContain(token);

    // The process now knows what the live token is — as it does from the next boot onwards.
    rememberSecret(token);
    const [entry] = await open().list();
    expect(JSON.stringify(entry)).not.toContain(token);
    expect((entry.detail as Record<string, unknown>).note).toBe("reconnect failed for [redacted]");
  });

  it("rewrites the credential out of the file on the next trim", async () => {
    const token = "1//a-live-refresh-token";
    forgetSecrets();
    const log = open();
    await log.append({
      actor: person,
      method: "POST",
      path: "/api/setup/credentials",
      status: 200,
      body: { note: `token ${token}` },
    });
    // An entry old enough to be swept, so the trim actually rewrites the file.
    now -= (RETENTION_DAYS + 1) * DAY;
    const stale = open("audit.log");
    await stale.append({ actor: person, method: "POST", path: "/api/action/go-live", status: 200 });
    await stale.settled();

    rememberSecret(token);
    now += (RETENTION_DAYS + 1) * DAY;
    await open().trim();

    expect(await fs.readFile(path.join(dir, "audit.log"), "utf8")).not.toContain(token);
  });
});
