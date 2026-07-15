import { describe, expect, it } from "vitest";
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
    h.tick(59_999);
    expect(h.fills.pending()).toEqual(r);
    h.tick(1);
    expect(h.fills.pending()).toBeNull();
  });
});
