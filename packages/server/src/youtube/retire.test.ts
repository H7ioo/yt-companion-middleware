import { describe, expect, it, vi } from "vitest";
import type { youtube_v3 } from "googleapis";
import type { PreparedBroadcast } from "../storage/schema.js";
import {
  MISSING_GRACE_MS,
  RETIRE_GRACE_MS,
  airedAtOf,
  planSweep,
  retireOne,
  sweepBroadcasts,
} from "./retire.js";

const NOW = Date.parse("2026-09-05T12:00:00.000Z");

function record(over: Partial<PreparedBroadcast> = {}): PreparedBroadcast {
  return {
    id: "ours-1",
    title: "Friday night",
    privacyStatus: "unlisted",
    // Yesterday: comfortably past due once the grace window is applied.
    scheduledStartTime: "2026-09-04T18:00:00.000Z",
    streamId: "stream-9",
    watchUrl: "https://www.youtube.com/watch?v=ours-1",
    createdAt: "2026-09-03T10:00:00.000Z",
    presetId: null,
    airedAt: null,
    retiredAt: null,
    retiredReason: null,
    ...over,
  };
}

function remote(over: Partial<youtube_v3.Schema$LiveBroadcast> = {}): youtube_v3.Schema$LiveBroadcast {
  return {
    id: "ours-1",
    snippet: { title: "Friday night", scheduledStartTime: "2026-09-04T18:00:00.000Z" },
    status: { lifeCycleStatus: "created" },
    ...over,
  };
}

describe("airedAtOf", () => {
  it("reads the time YouTube says it actually started", () => {
    expect(airedAtOf(remote({ snippet: { actualStartTime: "2026-09-04T18:01:02.000Z" } }))).toBe(
      "2026-09-04T18:01:02.000Z",
    );
  });

  it("counts a completed broadcast as aired even with no start time on the resource", () => {
    expect(airedAtOf(remote({ status: { lifeCycleStatus: "complete" } }))).not.toBeNull();
  });

  it.each(["live", "liveStarting", "testing", "testStarting", "complete"])(
    "treats lifeCycleStatus %s as aired",
    (s) => {
      expect(airedAtOf(remote({ status: { lifeCycleStatus: s } }))).not.toBeNull();
    },
  );

  it("says nothing for a broadcast that has only ever been created or made ready", () => {
    expect(airedAtOf(remote({ status: { lifeCycleStatus: "created" } }))).toBeNull();
    expect(airedAtOf(remote({ status: { lifeCycleStatus: "ready" } }))).toBeNull();
  });
});

describe("planSweep", () => {
  it("retires an app-created broadcast that is past due and never aired", () => {
    const plan = planSweep([record()], [remote()], NOW);
    expect(plan.retire.map((r) => r.record.id)).toEqual(["ours-1"]);
  });

  it("never retires a broadcast this app did not create, whatever its state", () => {
    // Two strays on the channel — a past-due one and a stub — and no ownership record for either.
    const strays = [
      remote({ id: "studio-1", snippet: { scheduledStartTime: "2020-01-01T00:00:00.000Z" } }),
      remote({ id: "studio-2", snippet: {} }),
    ];
    const plan = planSweep([], strays, NOW);
    expect(plan.retire).toEqual([]);
    expect(plan.aired).toEqual([]);
    expect(plan.gone).toEqual([]);
  });

  it("never retires one that aired, however long ago it was scheduled", () => {
    const plan = planSweep(
      [record({ scheduledStartTime: "2026-01-01T00:00:00.000Z" })],
      [remote({ snippet: { actualStartTime: "2026-01-01T00:00:30.000Z" } })],
      NOW,
    );
    expect(plan.retire).toEqual([]);
    expect(plan.aired.map((a) => a.record.id)).toEqual(["ours-1"]);
  });

  it("never retires one already stamped as aired, even if YouTube no longer says so", () => {
    const plan = planSweep([record({ airedAt: "2026-09-04T18:01:00.000Z" })], [remote()], NOW);
    expect(plan.retire).toEqual([]);
  });

  it("keeps one whose start time has not passed the grace window yet", () => {
    const scheduled = new Date(NOW - RETIRE_GRACE_MS + 60_000).toISOString();
    const plan = planSweep([record({ scheduledStartTime: scheduled })], [remote()], NOW);
    expect(plan.retire).toEqual([]);
  });

  it("keeps one scheduled for later tonight", () => {
    const scheduled = new Date(NOW + 6 * 60 * 60 * 1000).toISOString();
    const plan = planSweep([record({ scheduledStartTime: scheduled })], [remote()], NOW);
    expect(plan.retire).toEqual([]);
  });

  it("keeps one with no scheduled start — nothing says its time has passed", () => {
    const plan = planSweep([record({ scheduledStartTime: null })], [remote()], NOW);
    expect(plan.retire).toEqual([]);
  });

  it("skips a record already retired, so a deleted broadcast is never deleted twice", () => {
    const plan = planSweep([record({ retiredAt: "2026-09-05T09:00:00.000Z" })], [], NOW);
    expect(plan.retire).toEqual([]);
    expect(plan.gone).toEqual([]);
  });

  it("keeps one created moments ago, however far in the past its slot was", () => {
    // The prepare route accepts a start time already gone. Without the second window, the next
    // press of Prepare would delete a broadcast made a minute earlier, unasked.
    const plan = planSweep(
      [record({ createdAt: new Date(NOW - 60_000).toISOString() })],
      [remote()],
      NOW,
    );
    expect(plan.retire).toEqual([]);
  });

  it("marks a record whose broadcast YouTube no longer has as gone, not as one to delete", () => {
    // Another owned id comes back, so the read did answer — the missing one really is missing.
    const plan = planSweep([record(), record({ id: "ours-2" })], [remote({ id: "ours-2" })], NOW);
    expect(plan.retire.map((r) => r.record.id)).toEqual(["ours-2"]);
    expect(plan.gone.map((g) => g.record.id)).toEqual(["ours-1"]);
  });

  it("stamps nothing when YouTube names none of the ids it was asked about", () => {
    // What reconnecting OAuth to a different channel looks like. Calling the whole list gone
    // would strike out every live link at once, and the stamp is never revisited.
    const plan = planSweep([record(), record({ id: "ours-2" })], [], NOW);
    expect(plan.gone).toEqual([]);
    expect(plan.retire).toEqual([]);
  });

  it("leaves a just-created record alone when the list does not mention it yet", () => {
    const plan = planSweep(
      [record({ id: "fresh", createdAt: new Date(NOW - MISSING_GRACE_MS + 60_000).toISOString() }), record({ id: "ours-2" })],
      [remote({ id: "ours-2" })],
      NOW,
    );
    expect(plan.gone).toEqual([]);
  });
});

/** A client that answers a list of ids and records every delete it is asked for. */
function fakeYt(opts: { items?: youtube_v3.Schema$LiveBroadcast[]; deleteFails?: string[] } = {}) {
  const listed: string[][] = [];
  const deleted: string[] = [];
  const yt = {
    liveBroadcasts: {
      list: vi.fn(async (params: any) => {
        listed.push(params.id ?? []);
        const ids: string[] = params.id ?? [];
        return { data: { items: (opts.items ?? []).filter((i) => ids.includes(i.id ?? "")) } };
      }),
      delete: vi.fn(async (params: any) => {
        if (opts.deleteFails?.includes(params.id)) throw new Error("nope");
        deleted.push(params.id);
        return { data: {} };
      }),
    },
  } as unknown as youtube_v3.Youtube;
  return { yt, listed, deleted };
}

describe("sweepBroadcasts", () => {
  it("only ever asks YouTube about ids this app recorded as its own", async () => {
    const { yt, listed } = fakeYt({ items: [remote()] });
    await sweepBroadcasts(yt, [record()], { now: NOW });
    expect(listed).toEqual([["ours-1"]]);
  });

  it("deletes the past-due one and reports it, stamped with when and why", async () => {
    const { yt, deleted } = fakeYt({ items: [remote()] });
    const updated: PreparedBroadcast[] = [];
    const result = await sweepBroadcasts(yt, [record()], {
      now: NOW,
      onUpdate: async (r) => {
        updated.push(r);
      },
    });
    expect(deleted).toEqual(["ours-1"]);
    expect(result.retired).toHaveLength(1);
    expect(result.retired[0].retiredAt).toBe(new Date(NOW).toISOString());
    expect(result.retired[0].retiredReason).toMatch(/never went to air/i);
    expect(updated.map((u) => u.id)).toEqual(["ours-1"]);
  });

  it("makes no calls at all when nothing is owned", async () => {
    const { yt } = fakeYt();
    const result = await sweepBroadcasts(yt, [], { now: NOW });
    expect(yt.liveBroadcasts.list).not.toHaveBeenCalled();
    expect(result.quotaUnits).toBe(0);
  });

  it("stamps an aired broadcast without deleting it", async () => {
    const { yt, deleted } = fakeYt({
      items: [remote({ snippet: { actualStartTime: "2026-09-04T18:00:30.000Z" } })],
    });
    const result = await sweepBroadcasts(yt, [record()], { now: NOW });
    expect(deleted).toEqual([]);
    expect(result.aired[0].airedAt).toBe("2026-09-04T18:00:30.000Z");
  });

  it("keeps going when one delete fails, and says which one did not go", async () => {
    const { yt, deleted } = fakeYt({
      items: [remote(), remote({ id: "ours-2" })],
      deleteFails: ["ours-1"],
    });
    const result = await sweepBroadcasts(
      yt,
      [record(), record({ id: "ours-2", watchUrl: "https://www.youtube.com/watch?v=ours-2" })],
      { now: NOW },
    );
    expect(deleted).toEqual(["ours-2"]);
    expect(result.retired.map((r) => r.id)).toEqual(["ours-2"]);
    expect(result.failed.map((f) => f.id)).toEqual(["ours-1"]);
  });

  it("asks in pages of fifty, so a channel full of ghosts is swept fully and not partly", async () => {
    // 60 owned records. A single `id=` read tops out at 50, and the ten it silently dropped would
    // be the ones still filling the channel — the very state this sweep exists to clear.
    const many = Array.from({ length: 60 }, (_, i) =>
      record({ id: `ours-${i}`, watchUrl: `https://www.youtube.com/watch?v=ours-${i}` }),
    );
    const { yt, listed, deleted } = fakeYt({
      items: many.map((m) => remote({ id: m.id })),
    });
    const result = await sweepBroadcasts(yt, many, { now: NOW });

    expect(listed.map((page) => page.length)).toEqual([50, 10]);
    expect(deleted).toHaveLength(60);
    expect(result.quotaUnits).toBe(2 + 60 * 50);
  });

  it("charges the read and each delete against the quota estimate it reports", async () => {
    const { yt } = fakeYt({ items: [remote()] });
    const result = await sweepBroadcasts(yt, [record()], { now: NOW });
    expect(result.quotaUnits).toBe(1 + 50);
  });
});

describe("retireOne", () => {
  it("deletes the named broadcast and hands back the stamped record", async () => {
    const { yt, deleted } = fakeYt({ items: [remote()] });
    const out = await retireOne(yt, record(), { now: NOW, reason: "Deleted by hand." });
    expect(deleted).toEqual(["ours-1"]);
    expect(out.retiredAt).toBe(new Date(NOW).toISOString());
    expect(out.retiredReason).toBe("Deleted by hand.");
  });

  it("treats a broadcast YouTube already lost as retired rather than as a failure", async () => {
    const err: any = new Error("Not found");
    err.response = { status: 404, data: { error: { errors: [{ reason: "notFound" }] } } };
    const yt = {
      liveBroadcasts: {
        delete: vi.fn(async () => {
          throw err;
        }),
      },
    } as unknown as youtube_v3.Youtube;
    const out = await retireOne(yt, record(), { now: NOW, reason: "Deleted by hand." });
    expect(out.retiredAt).toBe(new Date(NOW).toISOString());
  });
});
