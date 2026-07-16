import { describe, expect, it, vi } from "vitest";
import { FillRequests } from "./fillRequests.js";
import { StateEvents } from "./events.js";

function harness(startAt = 0) {
  let now = startAt;
  const events = new StateEvents();
  let changes = 0;
  events.onChange(() => changes++);
  const fills = new FillRequests(events, () => now);
  return {
    fills,
    tick: (ms: number) => {
      now += ms;
    },
    changes: () => changes,
  };
}

describe("FillRequests", () => {
  it("starts empty and raises a pending request", () => {
    const h = harness();
    expect(h.fills.pending()).toBeNull();
    const r = h.fills.request("p1");
    expect(h.fills.pending()).toEqual(r);
    expect(h.changes()).toBe(1);
  });

  it("broadcasts — a read never consumes the request, so every dashboard sees it", () => {
    const h = harness();
    const r = h.fills.request("p1");
    expect(h.fills.pending()).toEqual(r);
    expect(h.fills.pending()).toEqual(r);
    // Only the raise signalled; reads are pure.
    expect(h.changes()).toBe(1);
  });

  it("replaces a pending request — the latest key press wins", () => {
    const h = harness();
    h.fills.request("p1");
    const second = h.fills.request("p2");
    expect(h.fills.pending()).toEqual(second);
  });

  it("expires a request after the TTL", () => {
    const h = harness();
    const r = h.fills.request("p1");
    h.tick(29_999);
    expect(h.fills.pending()).toEqual(r);
    h.tick(1);
    expect(h.fills.pending()).toBeNull();
  });

  it("signals subscribers at expiry, so an open popup gets the push that closes it", () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.fills.request("p1");
      expect(h.changes()).toBe(1);
      vi.advanceTimersByTime(30_000);
      h.tick(30_000);
      expect(h.changes()).toBe(2);
      expect(h.fills.pending()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a replaced request reschedules expiry — the old timer must not kill the new slot early", () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.fills.request("p1");
      vi.advanceTimersByTime(20_000);
      h.tick(20_000);
      const second = h.fills.request("p2");
      vi.advanceTimersByTime(15_000);
      h.tick(15_000);
      expect(h.fills.pending()).toEqual(second);
    } finally {
      vi.useRealTimers();
    }
  });
});
