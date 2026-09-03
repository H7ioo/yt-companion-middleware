import { describe, expect, it } from "vitest";
import type { PreparedBroadcast } from "./schema.js";
import { RETIRE_GRACE_MS, summarizePrepared } from "./prepared.js";

const NOW = Date.parse("2026-09-03T18:00:00.000Z");

function record(over: Partial<PreparedBroadcast> = {}): PreparedBroadcast {
  return {
    id: "b1",
    title: "Friday night",
    privacyStatus: "unlisted",
    scheduledStartTime: "2026-09-03T19:00:00.000Z",
    streamId: "stream-9",
    watchUrl: "https://www.youtube.com/watch?v=b1",
    createdAt: "2026-09-03T17:00:00.000Z",
    presetId: "friday",
    airedAt: null,
    retiredAt: null,
    retiredReason: null,
    ...over,
  };
}

describe("summarizePrepared (issue 063)", () => {
  it("says nothing is prepared when the app has created nothing", () => {
    const readout = summarizePrepared([], NOW);
    expect(readout.state).toBe("none");
    expect(readout.id).toBeNull();
    expect(readout.watchUrl).toBeNull();
    // The words come from the glossary, so the key and the dashboard say the same thing.
    expect(readout.label).toBe("Nothing prepared");
  });

  it("says prepared and bound when the record carries the key it is bound to", () => {
    const readout = summarizePrepared([record()], NOW);
    expect(readout.state).toBe("prepared");
    expect(readout.id).toBe("b1");
    expect(readout.title).toBe("Friday night");
    expect(readout.watchUrl).toBe("https://www.youtube.com/watch?v=b1");
    expect(readout.streamId).toBe("stream-9");
  });

  // The half-finished preparation issue 062 leaves behind on a failed bind: the broadcast exists
  // and its link works, but nothing the encoder pushes will ever reach it.
  it("distinguishes prepared but not bound from prepared and bound", () => {
    const readout = summarizePrepared([record({ streamId: null })], NOW);
    expect(readout.state).toBe("unbound");
    expect(readout.id).toBe("b1");
    expect(readout.streamId).toBeNull();
  });

  it("ignores records this app has already retired", () => {
    const retired = record({ retiredAt: "2026-09-03T17:30:00.000Z", retiredReason: "swept" });
    expect(summarizePrepared([retired], NOW).state).toBe("none");
  });

  // Once it has aired the question has moved on: the deck's on-air key answers it, and a
  // "prepared" lamp still lit through the show is one more thing reading yesterday's news.
  it("ignores records that have already been on air", () => {
    const aired = record({ airedAt: "2026-09-03T17:45:00.000Z" });
    expect(summarizePrepared([aired], NOW).state).toBe("none");
  });

  // The same window the sweep uses to call an unused broadcast a leftover (issue 064). Before it
  // passes the show is merely running late; after it, it was never going to happen.
  it("keeps a broadcast whose start has only just passed", () => {
    const late = record({ scheduledStartTime: new Date(NOW - RETIRE_GRACE_MS + 60_000).toISOString() });
    expect(summarizePrepared([late], NOW).state).toBe("prepared");
  });

  it("drops a broadcast whose start passed longer ago than the sweep's grace window", () => {
    const stale = record({ scheduledStartTime: new Date(NOW - RETIRE_GRACE_MS - 60_000).toISOString() });
    expect(summarizePrepared([stale], NOW).state).toBe("none");
  });

  // Mirrors planSweep: a record with no usable scheduled start falls back to when it was created,
  // so an undated leftover still ages out instead of standing forever.
  it("ages an undated record out on its creation time instead", () => {
    const fresh = record({ scheduledStartTime: null, createdAt: new Date(NOW - 60_000).toISOString() });
    expect(summarizePrepared([fresh], NOW).state).toBe("prepared");
    const old = record({ scheduledStartTime: null, createdAt: new Date(NOW - RETIRE_GRACE_MS - 1).toISOString() });
    expect(summarizePrepared([old], NOW).state).toBe("none");
  });

  it("reports the soonest standing broadcast when several are prepared", () => {
    const tonight = record({ id: "tonight", scheduledStartTime: "2026-09-03T19:00:00.000Z" });
    const nextWeek = record({ id: "next-week", scheduledStartTime: "2026-09-10T19:00:00.000Z" });
    expect(summarizePrepared([nextWeek, tonight], NOW).id).toBe("tonight");
  });

  // An unbound one still ahead of a bound one is the honest answer: it is the next thing to air,
  // and it is the one that will not receive the encoder.
  it("does not prefer a bound broadcast over a sooner unbound one", () => {
    const soonUnbound = record({ id: "soon", streamId: null, scheduledStartTime: "2026-09-03T19:00:00.000Z" });
    const laterBound = record({ id: "later", scheduledStartTime: "2026-09-03T21:00:00.000Z" });
    const readout = summarizePrepared([laterBound, soonUnbound], NOW);
    expect(readout.id).toBe("soon");
    expect(readout.state).toBe("unbound");
  });
});
