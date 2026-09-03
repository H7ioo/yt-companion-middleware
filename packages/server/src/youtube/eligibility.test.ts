import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JsonStore } from "../storage/jsonStore.js";
import { AppError } from "../core/errors.js";
import {
  ELIGIBILITY_REASONS,
  eligibilityRefusal,
  isEligibilityError,
  noteDriving,
  noteRidingMode,
  resetEligibility,
} from "./eligibility.js";

/** A GaxiosError-shaped refusal, the shape googleapis hands back from liveBroadcasts.insert. */
function ytError(status: number, reasons: string[] = [], message = "boom") {
  return {
    response: { status, data: { error: { errors: reasons.map((reason) => ({ reason })) } } },
    message,
  };
}

async function freshStore(): Promise<JsonStore> {
  const dir = mkdtempSync(path.join(tmpdir(), "elig-"));
  const store = new JsonStore(path.join(dir, "store.json"));
  await store.init();
  return store;
}

describe("eligibilityRefusal", () => {
  it.each(ELIGIBILITY_REASONS)("recognises %s on a 403", (reason) => {
    expect(eligibilityRefusal(ytError(403, [reason]))).toBe(reason);
  });

  it("picks the eligibility reason out of a list carrying others too", () => {
    expect(eligibilityRefusal(ytError(403, ["forbidden", "livePermissionBlocked"]))).toBe(
      "livePermissionBlocked",
    );
  });

  // The whole point of detecting rather than guessing: a channel that is merely offline or
  // having a bad server day has said nothing at all about its eligibility.
  it("returns null for a 5xx, even one naming an eligibility-shaped reason", () => {
    expect(eligibilityRefusal(ytError(500, ["liveStreamingNotEnabled"]))).toBeNull();
  });

  it("returns null for a transport failure with no HTTP response", () => {
    expect(eligibilityRefusal({ code: "ECONNREFUSED", message: "no route" })).toBeNull();
  });

  it("returns null for a plain 403 with no reason", () => {
    expect(eligibilityRefusal(ytError(403))).toBeNull();
  });

  it("returns null for a quota refusal", () => {
    expect(eligibilityRefusal(ytError(403, ["quotaExceeded"]))).toBeNull();
  });
});

describe("isEligibilityError", () => {
  it("is true only for the mapped AppError", () => {
    expect(isEligibilityError(new AppError("LIVE_NOT_ELIGIBLE"))).toBe(true);
    expect(isEligibilityError(new AppError("YOUTUBE_AUTH_ERROR"))).toBe(false);
    expect(isEligibilityError(ytError(403, ["livePermissionBlocked"]))).toBe(false);
  });
});

describe("the recorded mode", () => {
  it("starts unknown — nothing has been tried, so nothing is claimed", async () => {
    const store = await freshStore();
    expect(store.get().liveEligibility).toEqual({
      mode: "unknown",
      reason: null,
      message: null,
      checkedAt: null,
    });
  });

  it("records riding mode with YouTube's own reason and words", async () => {
    const store = await freshStore();
    await noteRidingMode(store, {
      reason: "insufficientLivePermissions",
      message: "The user is not enabled for live streaming.",
      now: "2026-09-03T10:00:00.000Z",
    });
    expect(store.get().liveEligibility).toEqual({
      mode: "riding",
      reason: "insufficientLivePermissions",
      message: "The user is not enabled for live streaming.",
      checkedAt: "2026-09-03T10:00:00.000Z",
    });
  });

  it("records driving mode and drops the stale refusal", async () => {
    const store = await freshStore();
    await noteRidingMode(store, { reason: "livePermissionBlocked", message: "no", now: "2026-09-01T00:00:00.000Z" });
    await noteDriving(store, "2026-09-03T10:00:00.000Z");
    expect(store.get().liveEligibility).toEqual({
      mode: "driving",
      reason: null,
      message: null,
      checkedAt: "2026-09-03T10:00:00.000Z",
    });
  });

  // Eligibility is a fact about a channel, not about this app, so it cannot outlive the
  // connection it was learned through: reconnecting may well be reconnecting to another channel.
  it("resets to unknown when the connection changes", async () => {
    const store = await freshStore();
    await noteRidingMode(store, { reason: "livePermissionBlocked", message: "no", now: "2026-09-01T00:00:00.000Z" });
    await resetEligibility(store);
    expect(store.get().liveEligibility.mode).toBe("unknown");
    expect(store.get().liveEligibility.checkedAt).toBeNull();
  });

  it("does not rewrite the store when the mode is already what it would write", async () => {
    const store = await freshStore();
    await noteRidingMode(store, { reason: "livePermissionBlocked", message: "no", now: "2026-09-01T00:00:00.000Z" });
    await noteRidingMode(store, { reason: "livePermissionBlocked", message: "no", now: "2026-09-02T00:00:00.000Z" });
    // The first observation is the one that dates the finding — re-observing the same refusal on
    // every poll must not make it look freshly discovered.
    expect(store.get().liveEligibility.checkedAt).toBe("2026-09-01T00:00:00.000Z");
  });
});
