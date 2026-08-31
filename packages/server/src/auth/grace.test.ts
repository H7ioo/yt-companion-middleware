import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../storage/jsonStore.js";
import { Grace, GRACE_DAYS_REQUIRED, GRACE_GO_LIVES_REQUIRED } from "./grace.js";

const DAY = 24 * 60 * 60 * 1000;

let dir: string;
let store: JsonStore;
let now: number;

function grace(): Grace {
  return new Grace(store, () => now);
}

/** A tokenless caller, described the way the guard describes one. */
const COMPANION = {
  client: "Companion/3.4.0",
  from: "192.168.1.40",
  route: "/api/action",
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "grace-"));
  store = new JsonStore(path.join(dir, "store.json"));
  await store.init();
  now = Date.UTC(2026, 0, 1);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("Grace", () => {
  it("starts in grace mode, because turning it on before the module has a token is the outage", async () => {
    expect(grace().readout().enforcing).toBe(false);
  });

  it("records every tokenless connection, naming who it was", async () => {
    const g = grace();
    await g.recordTokenless(COMPANION);

    const r = g.readout();
    expect(r.tokenlessCount).toBe(1);
    expect(r.lastTokenlessAt).toBe(new Date(now).toISOString());
    expect(r.lastTokenlessClient).toBe("Companion/3.4.0");
    expect(r.lastTokenlessFrom).toBe("192.168.1.40");
    expect(r.lastTokenlessRoute).toBe("/api/action");
  });

  it("is not met while something is still connecting the old way", async () => {
    const g = grace();
    await g.recordTokenless(COMPANION);
    expect(g.readout().met).toBe(false);
    expect(g.readout().daysSinceTokenless).toBe(0);
  });

  it("does not call fourteen quiet days met on their own", async () => {
    // The failure this slice exists to prevent: a 14-day off-season satisfies the clock while the
    // still-tokenless Companion machine sits powered down, grace mode comes off, and the next
    // show goes dark. The days half alone is not evidence.
    const g = grace();
    await g.recordTokenless(COMPANION);
    now += GRACE_DAYS_REQUIRED * DAY;

    const r = g.readout();
    expect(r.daysSinceTokenless).toBe(GRACE_DAYS_REQUIRED);
    expect(r.goLivesSinceTokenless).toBe(0);
    expect(r.met).toBe(false);
  });

  it("does not call a busy fortnight met either, when the days are short", async () => {
    const g = grace();
    await g.recordTokenless(COMPANION);
    now += 3 * DAY;
    await g.recordGoLive("show-1");
    await g.recordGoLive("show-2");

    const r = g.readout();
    expect(r.goLivesSinceTokenless).toBe(2);
    expect(r.daysSinceTokenless).toBe(3);
    expect(r.met).toBe(false);
  });

  it("is met only when both halves hold", async () => {
    const g = grace();
    await g.recordTokenless(COMPANION);
    now += GRACE_DAYS_REQUIRED * DAY;
    await g.recordGoLive("show-1");

    const r = g.readout();
    expect(r.daysSinceTokenless).toBe(GRACE_DAYS_REQUIRED);
    expect(r.goLivesSinceTokenless).toBeGreaterThanOrEqual(GRACE_GO_LIVES_REQUIRED);
    expect(r.met).toBe(true);
  });

  it("resets both counters when something connects tokenless again", async () => {
    const g = grace();
    await g.recordTokenless(COMPANION);
    now += GRACE_DAYS_REQUIRED * DAY;
    await g.recordGoLive("show-1");
    expect(g.readout().met).toBe(true);

    // A show ran tokenless after all. The evidence starts over — both halves, not just the clock.
    await g.recordTokenless({ ...COMPANION, route: "/api/feedback" });

    const r = g.readout();
    expect(r.met).toBe(false);
    expect(r.daysSinceTokenless).toBe(0);
    expect(r.goLivesSinceTokenless).toBe(0);
    expect(r.tokenlessCount).toBe(2);
  });

  it("counts one show as one go-live, however often the poll loop sees it", async () => {
    const g = grace();
    await g.recordTokenless(COMPANION);
    for (let i = 0; i < 50; i += 1) {
      now += 5000;
      await g.recordGoLive("show-1");
    }
    expect(g.readout().goLivesSinceTokenless).toBe(1);

    // A different broadcast is a different show.
    await g.recordGoLive("show-2");
    expect(g.readout().goLivesSinceTokenless).toBe(2);
  });

  it("does not rewrite the store once a live show has already been counted", async () => {
    const g = grace();
    await g.recordGoLive("show-1");
    const before = await fs.stat(path.join(dir, "store.json"));
    for (let i = 0; i < 20; i += 1) {
      now += 5000;
      await g.recordGoLive("show-1");
    }
    expect((await fs.stat(path.join(dir, "store.json"))).mtimeMs).toBe(before.mtimeMs);
  });

  it("reports no days at all when nothing has ever connected tokenless", () => {
    const r = grace().readout();
    // Null, not zero: "nothing has ever connected the old way" and "one did just now" are
    // opposite answers, and rendering both as 0 days would read as the alarming one.
    expect(r.daysSinceTokenless).toBeNull();
    expect(r.met).toBe(false);
  });

  it("is met on a deployment that has run a show and never seen a tokenless caller", async () => {
    const g = grace();
    await g.recordGoLive("show-1");
    // No tokenless connection has ever happened, so there is nothing to wait fourteen days from —
    // but the go-live half still has to hold, or a freshly installed server would read as met
    // before it had ever carried a show.
    expect(g.readout().met).toBe(true);
  });

  it("flips enforcement without a redeploy, and remembers it", async () => {
    const g = grace();
    await g.setEnforcing(true);
    expect(g.readout().enforcing).toBe(true);
    expect(g.enforcing).toBe(true);

    // Rollback is the same call the other way, which is what makes it usable at 8pm on a show night.
    await g.setEnforcing(false);
    expect(new Grace(store, () => now).readout().enforcing).toBe(false);
  });

  it("does not rewrite the store on every poll, and still counts every connection", async () => {
    // Companion polls every few seconds and each store write rewrites the whole file. The
    // counters this feeds have a fourteen-*day* window; recording each one to disk would rewrite
    // store.json every five seconds for the entire migration.
    const g = grace();
    await g.recordTokenless(COMPANION);
    const before = await fs.stat(path.join(dir, "store.json"));
    for (let i = 0; i < 20; i += 1) {
      now += 5000;
      await g.recordTokenless(COMPANION);
    }
    expect((await fs.stat(path.join(dir, "store.json"))).mtimeMs).toBe(before.mtimeMs);
    // Every one is still counted — the count is the size of the problem, not a sample of it.
    expect(g.readout().tokenlessCount).toBe(21);

    now += 10 * 60 * 1000;
    await g.recordTokenless(COMPANION);
    expect(g.readout().tokenlessCount).toBe(22);
    // And it has actually landed, so a restart does not forget the fortnight.
    expect(new Grace(store, () => now).readout().tokenlessCount).toBe(22);
  });

  it("writes at once when a tokenless caller returns after a quiet stretch", async () => {
    // The reset of both counters is a correctness property, not a housekeeping one: a show that
    // ran tokenless must not stay "met" for another five minutes because the write was deferred.
    const g = grace();
    now += GRACE_DAYS_REQUIRED * DAY;
    await g.recordGoLive("show-1");
    expect(g.readout().met).toBe(true);

    await g.recordTokenless(COMPANION);

    expect(new Grace(store, () => now).readout().met).toBe(false);
  });

  it("keeps deferring writes while a show is on air, rather than rewriting the store per poll", async () => {
    // The two paths interleave for the whole broadcast: Companion polls tokenless every few
    // seconds, and the poll loop reports the same live show just as often. Clearing lastGoLiveId
    // on a tokenless connection let the next poll re-count that show, which made the next
    // tokenless connection's verdict change and write again — two full store.json rewrites per
    // poll cycle, for hours, which is exactly what the deferral exists to prevent.
    const g = grace();
    // One full cycle first: the show is counted, and the tokenless connection after it zeroes
    // that count — one write each, and both are the verdict genuinely moving. What must not
    // happen is that pair repeating for every poll after it.
    await g.recordTokenless(COMPANION);
    await g.recordGoLive("show-1");
    await g.recordTokenless(COMPANION);

    // Counted rather than read off the file's mtime: what matters is that neither path *asks*
    // for a write, and a filesystem's timestamp granularity is not the thing under test.
    const real = store.update.bind(store);
    let writes = 0;
    store.update = (fn) => {
      writes += 1;
      return real(fn);
    };
    for (let i = 0; i < 20; i += 1) {
      now += 5000;
      await g.recordTokenless(COMPANION);
      await g.recordGoLive("show-1");
    }
    store.update = real;

    expect(writes).toBe(0);
    expect(g.readout().tokenlessCount).toBe(22);
    // And the verdict is still the right one: the show ran tokenless, so it is not evidence.
    expect(g.readout().goLivesSinceTokenless).toBe(0);
    expect(g.readout().met).toBe(false);
  });

  it("counts the next show once the tokenless caller is gone", async () => {
    // The other half of keeping lastGoLiveId: the show that ran tokenless is not re-counted, but
    // a *new* show is, or the counter could never be satisfied after a single tokenless poll.
    const g = grace();
    await g.recordGoLive("show-1");
    await g.recordTokenless(COMPANION);
    expect(g.readout().goLivesSinceTokenless).toBe(0);

    now += DAY;
    await g.recordGoLive("show-2");
    expect(g.readout().goLivesSinceTokenless).toBe(GRACE_GO_LIVES_REQUIRED);
  });

  it("keeps the pending count when the store write fails, rather than dropping it on the caller", async () => {
    // Recording is bookkeeping beside a Companion action that is otherwise fine. A failed disk
    // write must not lose the connections already counted, and must not 500 a cue.
    const g = grace();
    await g.recordTokenless(COMPANION);
    const real = store.update.bind(store);
    store.update = () => Promise.reject(new Error("disk full"));

    now += 10 * 60 * 1000;
    await expect(g.recordTokenless(COMPANION)).resolves.toBeUndefined();
    expect(g.readout().tokenlessCount).toBe(2);

    store.update = real;
    now += 10 * 60 * 1000;
    await g.recordTokenless(COMPANION);
    // All three landed: the failed write's counts rode along with the next one.
    expect(new Grace(store, () => now).readout().tokenlessCount).toBe(3);
  });

  it("trims a client string rather than storing whatever length a caller sends", async () => {
    const g = grace();
    await g.recordTokenless({ ...COMPANION, client: "x".repeat(5000) });
    expect(g.readout().lastTokenlessClient!.length).toBeLessThanOrEqual(200);
  });
});
