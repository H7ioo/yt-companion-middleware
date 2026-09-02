import { describe, expect, it } from "vitest";
import type { CacheState } from "../storage/schema.js";
import { FAST_POLL_INTERVAL_MS, FAST_POLL_WINDOW_MS, pollIntervalMs } from "./pollCadence.js";

const NORMAL_MS = 60_000;
const NOW = Date.parse("2026-09-01T20:00:00.000Z");

/** A cache snapshot with a latch armed `agoMs` ago, on an idle channel. */
function armed(agoMs: number, isLive = false): CacheState {
  return {
    status: { broadcastId: "bc1", title: "on air", privacyStatus: "public", isLive, noTarget: false },
    activePresetId: null,
    activePresetTitle: null,
    activePresetTargetId: null,
    undoSnapshot: null,
    health: "ok",
    healthMessage: null,
    lastRefreshedAt: null,
    targetConflict: null,
    pendingMetadata: {
      payload: { title: "Tonight's show" },
      targetId: "old-broadcast",
      capturedAt: new Date(NOW - agoMs).toISOString(),
    },
    ingestion: null,
    lastTargetId: "old-broadcast",
  };
}

describe("poll cadence (issue 054 / PRD-14)", () => {
  it("polls fast when a fresh latch is armed on an idle channel", () => {
    const ms = pollIntervalMs({
      cache: armed(60_000),
      apiEnabled: true,
      normalIntervalMs: NORMAL_MS,
      now: NOW,
    });
    expect(ms).toBe(FAST_POLL_INTERVAL_MS);
  });

  it("stays on the normal interval in every state that is not armed-and-idle", () => {
    const idle = { ...armed(60_000), pendingMetadata: null };
    const cases: Array<[string, CacheState, boolean]> = [
      ["armed but already live", armed(60_000, true), true],
      ["armed but past the fast window", armed(FAST_POLL_WINDOW_MS + 1), true],
      ["no latch armed", idle, true],
      ["API switched off", armed(60_000), false],
    ];
    for (const [name, cache, apiEnabled] of cases) {
      const ms = pollIntervalMs({ cache, apiEnabled, normalIntervalMs: NORMAL_MS, now: NOW });
      expect(ms, name).toBe(NORMAL_MS);
    }
  });

  it("never polls slower than the configured interval", () => {
    // A deployment that set REFRESH_INTERVAL_SECONDS below the fast interval already wants to
    // poll faster than this feature does; the fast path must not slow it down.
    const ms = pollIntervalMs({
      cache: armed(60_000),
      apiEnabled: true,
      normalIntervalMs: 5_000,
      now: NOW,
    });
    expect(ms).toBe(5_000);
  });
});
