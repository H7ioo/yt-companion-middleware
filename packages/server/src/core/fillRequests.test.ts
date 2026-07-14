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
  it("starts empty and raises a claimable request", () => {
    const h = harness();
    expect(h.fills.pending()).toBeNull();
    const r = h.fills.request("p1");
    expect(h.fills.pending()).toEqual(r);
    expect(h.changes()).toBe(1);
  });

  it("lets exactly one claim win and signals both transitions", () => {
    const h = harness();
    const r = h.fills.request("p1");
    expect(h.fills.claim(r.id)).toBe(true);
    expect(h.fills.claim(r.id)).toBe(false);
    expect(h.fills.pending()).toBeNull();
    expect(h.changes()).toBe(2);
  });

  it("replaces a pending request — the latest key press wins", () => {
    const h = harness();
    const first = h.fills.request("p1");
    const second = h.fills.request("p2");
    expect(h.fills.claim(first.id)).toBe(false);
    expect(h.fills.pending()).toEqual(second);
  });

  it("expires an unclaimed request after the TTL", () => {
    const h = harness();
    const r = h.fills.request("p1");
    h.tick(59_999);
    expect(h.fills.pending()).toEqual(r);
    h.tick(1);
    expect(h.fills.pending()).toBeNull();
    expect(h.fills.claim(r.id)).toBe(false);
  });
});
