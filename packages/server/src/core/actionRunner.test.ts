import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import type { youtube_v3 } from "googleapis";
import { ActionRunner, togglePrivacy, snapshotOf } from "./actionRunner.js";
import type { BroadcastResource } from "./resolve.js";
import { AppError } from "./errors.js";
import { JsonStore } from "../storage/jsonStore.js";
import { StateCache } from "./stateCache.js";
import type { Preset } from "../storage/schema.js";

describe("togglePrivacy", () => {
  it("flips private -> public", () => {
    expect(togglePrivacy("private")).toBe("public");
  });

  it("flips public -> private", () => {
    expect(togglePrivacy("public")).toBe("private");
  });

  it("treats unlisted as visible and flips it to private", () => {
    expect(togglePrivacy("unlisted")).toBe("private");
  });

  it("defaults an unknown/absent value to private (fail closed)", () => {
    expect(togglePrivacy(null)).toBe("private");
    expect(togglePrivacy(undefined)).toBe("private");
  });
});

describe("snapshotOf (undo capture)", () => {
  const broadcast: BroadcastResource = {
    id: "v1",
    snippet: { title: "Old title", description: "Old desc" },
    status: { privacyStatus: "public" },
    contentDetails: { boundStreamId: "stream-9" },
  };

  it("captures the owned broadcast fields", () => {
    const snap = snapshotOf(broadcast);
    expect(snap.payload).toEqual({
      title: "Old title",
      description: "Old desc",
      privacyStatus: "public",
      streamBoundId: "stream-9",
    });
    expect(snap.label).toBe("Old title");
    expect(snap.capturedAt).toBeTypeOf("string");
  });

  it("omits an out-of-enum privacy value rather than restoring garbage", () => {
    const snap = snapshotOf({ ...broadcast, status: { privacyStatus: "weird" } });
    expect(snap.payload.privacyStatus).toBeUndefined();
  });

  it("omits stream binding when the target has none", () => {
    const snap = snapshotOf({ ...broadcast, contentDetails: {} });
    expect(snap.payload.streamBoundId).toBeUndefined();
  });
});

describe("ActionRunner.runPreset template handling", () => {
  function makeRunner(preset: Preset, apiEnabled = true) {
    // Only store.get() is reached on the paths under test; YouTube is never called, so a
    // throwing stub guards against an accidental network hit.
    const store = { get: () => ({ presets: [preset], service: { apiEnabled } }) } as never;
    const yt = new Proxy({}, { get: () => { throw new Error("YouTube must not be called"); } }) as never;
    return new ActionRunner(yt, store, {} as never);
  }

  const templated: Preset = {
    id: "lesson",
    title: "Drs {lesson}",
    slug: "",
    description: "",
    privacyStatus: "public",
    category: null,
    streamBoundId: null,
    titleFallback: null,
    descriptionFallback: null,
  };

  it("rejects with MISSING_TEMPLATE_VARS before touching YouTube when a var is unresolved", async () => {
    const runner = makeRunner(templated);
    await expect(runner.runPreset("lesson", {})).rejects.toMatchObject({
      code: "MISSING_TEMPLATE_VARS",
    });
  });

  it("rejects with INVALID_PRESET for an unknown preset id", async () => {
    const runner = makeRunner(templated);
    await expect(runner.runPreset("nope")).rejects.toBeInstanceOf(AppError);
  });

  it("rejects with SERVICE_DISABLED before touching YouTube when the API is switched off", async () => {
    const runner = makeRunner({ ...templated, title: "Plain" }, false);
    await expect(runner.runPreset("lesson")).rejects.toMatchObject({ code: "SERVICE_DISABLED" });
  });
});

/**
 * The cache writes an action performs. These run against a real store so the ordering between
 * "the write landed on YouTube" and "the intent is latched" is pinned, not assumed.
 */
describe("ActionRunner cache writes", () => {
  let store: JsonStore;
  let dir: string;

  const idle = {
    id: "upcoming-1",
    snippet: {
      title: "Old",
      scheduledStartTime: new Date(Date.now() + 2 * 3600_000).toISOString(),
    },
    status: { lifeCycleStatus: "ready", privacyStatus: "public" },
  };

  /** A client serving one upcoming (idle) broadcast; `updateFails` rejects the PUT. */
  function ytFor(updateFails: boolean): youtube_v3.Youtube {
    return {
      liveBroadcasts: {
        list: async (p: youtube_v3.Params$Resource$Livebroadcasts$List) => ({
          data: {
            items: p.broadcastStatus === "active" ? [] : p.id || p.broadcastStatus === "upcoming" ? [idle] : [],
          },
        }),
        update: async () => {
          if (updateFails) throw new Error("YouTube said no");
          return { data: idle };
        },
      },
    } as unknown as youtube_v3.Youtube;
  }

  function runnerFor(updateFails = false) {
    const yt = ytFor(updateFails);
    const cache = new StateCache(yt, store, {
      refreshIntervalMs: 60_000,
      healthFailureThreshold: 3,
    });
    return new ActionRunner(yt, store, cache);
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "runner-"));
    store = new JsonStore(path.join(dir, "store.json"));
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("latches the intent when the write lands, so it can be replayed at go-live", async () => {
    await runnerFor().runUpdate({ title: "Tonight" });
    expect(store.get().cache.pendingMetadata?.payload.title).toBe("Tonight");
  });

  it("does not latch an edit YouTube rejected — it would land on the next show for nothing", async () => {
    await expect(runnerFor(true).runUpdate({ title: "Tonight" })).rejects.toThrow();
    expect(store.get().cache.pendingMetadata).toBeNull();
  });

  it("keeps a drift warning standing — applying a preset does not delete the stray broadcasts", async () => {
    await store.update((s) => {
      s.cache.targetConflict = { code: "TARGET_DRIFT", message: "drifted", ids: ["a", "b"] };
    });

    await runnerFor().runUpdate({ title: "Tonight" });
    expect(store.get().cache.targetConflict?.code).toBe("TARGET_DRIFT");
  });
});
