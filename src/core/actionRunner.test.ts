import { describe, expect, it } from "vitest";
import { ActionRunner, togglePrivacy, snapshotOf } from "./actionRunner.js";
import type { BroadcastResource } from "./resolve.js";
import { AppError } from "./errors.js";
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
  function makeRunner(preset: Preset) {
    // Only store.get() is reached on the paths under test; YouTube is never called, so a
    // throwing stub guards against an accidental network hit.
    const store = { get: () => ({ presets: [preset] }) } as never;
    const yt = new Proxy({}, { get: () => { throw new Error("YouTube must not be called"); } }) as never;
    return new ActionRunner(yt, store, {} as never);
  }

  const templated: Preset = {
    id: "lesson",
    title: "Drs {lesson}",
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
});
