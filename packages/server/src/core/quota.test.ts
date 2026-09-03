import { afterEach, describe, expect, it, vi } from "vitest";
import { QuotaTracker, QUOTA_COST, instrumentQuota, pacificDate } from "./quota.js";
import type { youtube_v3 } from "googleapis";
import { Logger } from "./logger.js";
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

  it("logs a single quota warning when usage first crosses 90%", () => {
    const logger = new Logger();
    const t = new QuotaTracker(fakeStore({ date: pacificDate(), used: 0 }), 100, undefined, logger);
    t.init();
    t.record(89); // 89% — below the line, no warning
    expect(logger.list()).toHaveLength(0);
    t.record(2); // 91% — crosses the line
    t.record(2); // 93% — already warned, stays quiet
    const quotaWarnings = logger.list().filter((e) => e.category === "quota");
    expect(quotaWarnings).toHaveLength(1);
    expect(quotaWarnings[0].level).toBe("warn");
  });

  it("warns again on the next Pacific day — the rollover resets the warning latch (PRD-10 §4)", () => {
    const logger = new Logger();
    // Injectable clock: noon PT on day 1, advanced past Pacific-midnight to day 2.
    let now = new Date("2026-07-12T12:00:00-07:00");
    const t = new QuotaTracker(
      fakeStore({ date: pacificDate(now), used: 0 }),
      100,
      undefined,
      logger,
      () => now,
    );
    t.init();

    t.record(91); // day 1 crosses 90% → first warning
    const quotaWarnings = () => logger.list().filter((e) => e.category === "quota");
    expect(quotaWarnings()).toHaveLength(1);

    // Cross Pacific-midnight into the next day. The next record rolls the counter (used → 0) and,
    // crucially, clears the latch so the 90% heads-up can fire again.
    now = new Date("2026-07-13T12:00:00-07:00");
    t.record(91); // day 2 crosses 90% afresh → second warning
    expect(quotaWarnings()).toHaveLength(2);
  });
});

describe("instrumentQuota", () => {
  /** The slice of the client this app calls, each returning nothing of interest. */
  function stubClient() {
    const nothing = async () => ({ data: {} });
    return {
      liveBroadcasts: { list: nothing, update: nothing, bind: nothing, insert: nothing },
      videos: { list: nothing, update: nothing },
      liveStreams: { list: nothing },
    } as unknown as youtube_v3.Youtube;
  }

  it("charges a broadcast insert as a write, so a preparation shows up in the budget", async () => {
    const t = new QuotaTracker(fakeStore({ date: pacificDate(), used: 0 }), 10000);
    t.init();
    const yt = instrumentQuota(stubClient(), t);

    // What one preparation costs: insert + bind (issue 062).
    await yt.liveBroadcasts.insert({});
    await yt.liveBroadcasts.bind({});

    expect(t.snapshot().used).toBe(QUOTA_COST.write * 2);
  });
});
