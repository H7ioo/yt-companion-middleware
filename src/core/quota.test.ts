import { afterEach, describe, expect, it, vi } from "vitest";
import { QuotaTracker, QUOTA_COST, pacificDate } from "./quota.js";
import type { JsonStore } from "../storage/jsonStore.js";
import type { Store } from "../storage/schema.js";

function fakeStore(quota: Store["quota"]): JsonStore {
  const state = { quota } as Store;
  return {
    get: () => state,
    update: async (mut: (s: Store) => Store | void) => {
      mut(state);
      return state;
    },
  } as unknown as JsonStore;
}

afterEach(() => vi.useRealTimers());

describe("QuotaTracker", () => {
  it("accumulates cost-weighted usage", () => {
    const t = new QuotaTracker(fakeStore({ date: pacificDate(), used: 0 }), 10000);
    t.init();
    t.record(QUOTA_COST.read); // 1
    t.record(QUOTA_COST.write); // 50
    const snap = t.snapshot();
    expect(snap.used).toBe(51);
    expect(snap.remaining).toBe(9949);
    expect(snap.limit).toBe(10000);
  });

  it("seeds today's persisted count on init", () => {
    const t = new QuotaTracker(fakeStore({ date: pacificDate(), used: 500 }), 10000);
    t.init();
    expect(t.snapshot().used).toBe(500);
  });

  it("discards a stale (prior-day) persisted count on init", () => {
    const t = new QuotaTracker(fakeStore({ date: "2000-01-01", used: 9999 }), 10000);
    t.init();
    expect(t.snapshot().used).toBe(0);
  });

  it("clamps remaining at zero when over budget", () => {
    const t = new QuotaTracker(fakeStore({ date: pacificDate(), used: 0 }), 10);
    t.init();
    t.record(50);
    expect(t.snapshot().remaining).toBe(0);
  });
});
