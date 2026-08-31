import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../storage/jsonStore.js";
import { DeviceTokens } from "./deviceTokens.js";
import { AppError } from "../core/errors.js";

const MINUTE = 60 * 1000;

let dir: string;
let store: JsonStore;
let now: number;

function tokens(): DeviceTokens {
  return new DeviceTokens(store, () => now);
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "device-tokens-"));
  store = new JsonStore(path.join(dir, "store.json"));
  await store.init();
  now = Date.UTC(2026, 0, 1);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("DeviceTokens", () => {
  it("hands the plaintext back once and never stores it", async () => {
    const dt = tokens();
    const { token, record } = await dt.create({ name: "companion machine", createdBy: "acc1" });

    expect(token.length).toBeGreaterThan(20);
    const raw = await fs.readFile(path.join(dir, "store.json"), "utf8");
    // The whole reason only a hash is kept: a leaked store.json must hand over nothing usable.
    expect(raw).not.toContain(token);
    expect(record.tokenHash).not.toBe(token);
    // And there is no way to ask for it again — the summary shape has no field for it.
    expect(Object.keys(dt.list()[0])).not.toContain("token");
  });

  it("verifies a token it issued, and refuses anything else", async () => {
    const dt = tokens();
    const { token, record } = await dt.create({ name: "booth laptop", createdBy: "acc1" });

    expect((await dt.verify(token))?.id).toBe(record.id);
    expect(await dt.verify(`${token}x`)).toBeNull();
    expect(await dt.verify("")).toBeNull();
    expect(await dt.verify(undefined)).toBeNull();
  });

  it("refuses a revoked token from its very next request", async () => {
    const dt = tokens();
    const { token, record } = await dt.create({ name: "companion machine", createdBy: "acc1" });
    expect(await dt.verify(token)).not.toBeNull();

    await dt.revoke(record.id);

    expect(await dt.verify(token)).toBeNull();
    // Kept, not deleted: "which token was live on the machine we just cut off?" still answers.
    expect(dt.list()).toHaveLength(1);
    expect(dt.list()[0].revokedAt).toBe(new Date(now).toISOString());
  });

  it("refuses to revoke a token that does not exist, rather than reporting success", async () => {
    await expect(tokens().revoke("nope")).rejects.toBeInstanceOf(AppError);
  });

  it("insists on a name, because the point of one is knowing what to revoke", async () => {
    await expect(tokens().create({ name: "  ", createdBy: "acc1" })).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it("records last use coarsely, so a busy module does not rewrite the store every request", async () => {
    const dt = tokens();
    const { token } = await dt.create({ name: "companion machine", createdBy: "acc1" });
    // The first use *is* worth a write: "never presented" and "presented a moment ago" are the
    // two answers an admin most wants from this column, so the baseline is taken after it.
    await dt.verify(token);
    expect(dt.list()[0].lastUsedAt).toBe(new Date(now).toISOString());
    const before = await fs.stat(path.join(dir, "store.json"));

    // A minute of Companion polling at its usual cadence.
    for (let i = 0; i < 12; i += 1) {
      now += 5000;
      await dt.verify(token);
    }
    const after = await fs.stat(path.join(dir, "store.json"));
    expect(after.mtimeMs).toBe(before.mtimeMs);

    now += 10 * MINUTE;
    await dt.verify(token);
    expect(dt.list()[0].lastUsedAt).toBe(new Date(now).toISOString());
  });

  it("keeps two tokens apart, so revoking one leaves the other working", async () => {
    const dt = tokens();
    const a = await dt.create({ name: "companion machine", createdBy: "acc1" });
    const b = await dt.create({ name: "booth laptop", createdBy: "acc1" });

    await dt.revoke(a.record.id);

    expect(await dt.verify(a.token)).toBeNull();
    expect((await dt.verify(b.token))?.name).toBe("booth laptop");
  });
});
