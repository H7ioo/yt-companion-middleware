import { describe, expect, it } from "vitest";
import type { youtube_v3 } from "googleapis";
import { resolveTarget, getBroadcast, toStatus, pickUpcoming } from "./broadcasts.js";

const NOW = Date.parse("2026-08-05T21:49:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const hoursAhead = (h: number) => new Date(NOW + h * 3600_000).toISOString();

/**
 * A minimal fake of the YouTube client's liveBroadcasts.list, keyed on the query the
 * production code sends: active status, upcoming status, or persistent type.
 */
function fakeYt(sets: {
  active?: youtube_v3.Schema$LiveBroadcast[];
  upcoming?: youtube_v3.Schema$LiveBroadcast[];
  persistent?: youtube_v3.Schema$LiveBroadcast[];
  byId?: youtube_v3.Schema$LiveBroadcast[];
}): youtube_v3.Youtube {
  return {
    liveBroadcasts: {
      list: async (params: youtube_v3.Params$Resource$Livebroadcasts$List) => {
        let items: youtube_v3.Schema$LiveBroadcast[] = [];
        if (params.id) items = sets.byId ?? [];
        else if (params.broadcastStatus === "active") items = sets.active ?? [];
        else if (params.broadcastStatus === "upcoming") items = sets.upcoming ?? [];
        else if (params.broadcastType === "persistent") items = sets.persistent ?? [];
        return { data: { items } };
      },
    },
  } as unknown as youtube_v3.Youtube;
}

describe("resolveTarget (PRD §2/§6 target precedence)", () => {
  it("prefers an active broadcast and marks it live", async () => {
    const yt = fakeYt({
      active: [{ id: "live-1" }],
      upcoming: [{ id: "up-1" }],
    });
    expect(await resolveTarget(yt)).toEqual({
      id: "live-1",
      isLive: true,
      conflict: null,
      autoStartMint: false,
    });
  });

  it("falls back to upcoming when nothing is active (not live)", async () => {
    const yt = fakeYt({ upcoming: [{ id: "up-1", status: { lifeCycleStatus: "ready" } }] });
    expect(await resolveTarget(yt)).toEqual({
      id: "up-1",
      isLive: false,
      conflict: null,
      autoStartMint: false,
    });
  });

  it("among upcoming, prefers the encoder-bound (testing) broadcast over a created stub", async () => {
    const yt = fakeYt({
      upcoming: [
        { id: "stub", status: { lifeCycleStatus: "created" } },
        { id: "bound", status: { lifeCycleStatus: "testing" } },
      ],
    });
    expect((await resolveTarget(yt)).id).toBe("bound");
  });

  it("falls back to the persistent container when nothing is active or upcoming", async () => {
    const yt = fakeYt({ persistent: [{ id: "persist-1" }] });
    expect(await resolveTarget(yt)).toEqual({
      id: "persist-1",
      isLive: false,
      conflict: null,
      autoStartMint: false,
    });
  });

  it("throws NO_TARGET_FOUND when nothing exists", async () => {
    await expect(resolveTarget(fakeYt({}))).rejects.toMatchObject({ code: "NO_TARGET_FOUND" });
  });

  it("marks a just-created broadcast starting about now as an auto-start mint", async () => {
    const yt = fakeYt({
      upcoming: [
        {
          id: "minted",
          snippet: { scheduledStartTime: hoursAgo(0.01), publishedAt: hoursAgo(0.01) },
          status: { lifeCycleStatus: "ready" },
        },
      ],
    });
    expect((await resolveTarget(yt, NOW)).autoStartMint).toBe(true);
  });

  it("does not call a broadcast scheduled for later tonight an auto-start mint", async () => {
    const yt = fakeYt({
      upcoming: [
        {
          id: "later",
          snippet: { scheduledStartTime: hoursAhead(2), publishedAt: hoursAgo(0.01) },
          status: { lifeCycleStatus: "ready" },
        },
      ],
    });
    expect((await resolveTarget(yt, NOW)).autoStartMint).toBe(false);
  });

  it("reports no conflict once live, even with a stray upcoming still around", async () => {
    const yt = fakeYt({
      active: [{ id: "live-1" }],
      upcoming: [{ id: "ghost", snippet: { scheduledStartTime: hoursAgo(1700) } }],
    });
    expect((await resolveTarget(yt, NOW)).conflict).toBeNull();
  });
});

/**
 * The go-live regression: a stale event from months ago beat the broadcast YouTube minted
 * seconds before air, because the old tiebreak was "earliest scheduled start" with no staleness
 * filter. Reproduced here with the real ids and times from the 2026-08-05 live test.
 */
describe("pickUpcoming", () => {
  const ghost = {
    id: "X8tfFO-lL7w",
    status: { lifeCycleStatus: "ready" },
    snippet: { title: "stale leftover", scheduledStartTime: "2026-05-25T22:16:19Z" },
    contentDetails: { boundStreamId: "stream-A" },
  };
  const real = {
    id: "kn_lwgeVyNY",
    status: { lifeCycleStatus: "ready" },
    snippet: { title: "tonight's show", scheduledStartTime: hoursAgo(0) },
    contentDetails: { boundStreamId: "stream-A" },
  };

  it("ignores a months-stale event and picks the one YouTube just minted", () => {
    expect(pickUpcoming([ghost, real], NOW)?.chosen.id).toBe("kn_lwgeVyNY");
  });

  it("flags the shared stream key when both are bound to the same encoder", () => {
    // Both fresh, so both survive the staleness filter and the ambiguity is real.
    const alsoFresh = { ...ghost, snippet: { ...ghost.snippet, scheduledStartTime: hoursAhead(1) } };
    const conflict = pickUpcoming([alsoFresh, real], NOW)?.conflict;
    expect(conflict?.code).toBe("SHARED_STREAM_KEY");
    expect(conflict?.ids).toEqual(expect.arrayContaining(["X8tfFO-lL7w", "kn_lwgeVyNY"]));
  });

  it("flags plain ambiguity when several upcoming use different stream keys", () => {
    const other = {
      id: "other",
      status: { lifeCycleStatus: "ready" },
      snippet: { scheduledStartTime: hoursAhead(2) },
      contentDetails: { boundStreamId: "stream-B" },
    };
    expect(pickUpcoming([real, other], NOW)?.conflict?.code).toBe("MULTIPLE_UPCOMING");
  });

  it("reports no conflict for a single upcoming broadcast", () => {
    expect(pickUpcoming([real], NOW)?.conflict).toBeNull();
  });

  it("still prefers readiness over schedule — a bound encoder beats a sooner stub", () => {
    const stub = {
      id: "stub",
      status: { lifeCycleStatus: "created" },
      snippet: { scheduledStartTime: hoursAhead(1) },
    };
    const bound = {
      id: "bound",
      status: { lifeCycleStatus: "testing" },
      snippet: { scheduledStartTime: hoursAhead(5) },
    };
    expect(pickUpcoming([stub, bound], NOW)?.chosen.id).toBe("bound");
  });

  it("falls back to stale candidates when every upcoming is stale", () => {
    expect(pickUpcoming([ghost], NOW)?.chosen.id).toBe("X8tfFO-lL7w");
  });

  it("returns null for an empty list", () => {
    expect(pickUpcoming([], NOW)).toBeNull();
  });

  it("does not let a stray scheduled earlier today beat the broadcast minted for air", () => {
    // Same-day strays survive the 12h staleness filter, so ordering has to demote them: with
    // the old "earliest scheduled start" tiebreak this reproduced the go-live regression.
    const earlierToday = {
      ...ghost,
      snippet: { ...ghost.snippet, scheduledStartTime: hoursAgo(3) },
    };
    expect(pickUpcoming([earlierToday, real], NOW)?.chosen.id).toBe("kn_lwgeVyNY");
  });

  it("prefers the mint over a stray scheduled for later tonight", () => {
    const laterTonight = {
      ...ghost,
      snippet: { ...ghost.snippet, scheduledStartTime: hoursAhead(3) },
    };
    expect(pickUpcoming([laterTonight, real], NOW)?.chosen.id).toBe("kn_lwgeVyNY");
  });

  it("picks the most recent among past-due candidates — just-missed beats this morning", () => {
    const thisMorning = {
      ...ghost,
      id: "morning",
      snippet: { ...ghost.snippet, scheduledStartTime: hoursAgo(8) },
    };
    const justMissed = {
      ...ghost,
      id: "just-missed",
      snippet: { ...ghost.snippet, scheduledStartTime: hoursAgo(1) },
    };
    expect(pickUpcoming([thisMorning, justMissed], NOW)?.chosen.id).toBe("just-missed");
  });
});

describe("getBroadcast", () => {
  it("returns the single item for the id", async () => {
    const yt = fakeYt({ byId: [{ id: "v1", snippet: { title: "Hi" } }] });
    expect((await getBroadcast(yt, "v1")).id).toBe("v1");
  });

  it("throws NO_TARGET_FOUND when the id is absent", async () => {
    await expect(getBroadcast(fakeYt({ byId: [] }), "gone")).rejects.toMatchObject({
      code: "NO_TARGET_FOUND",
    });
  });
});

describe("toStatus", () => {
  it("reads title and privacy, and treats a live lifecycle as live", () => {
    expect(
      toStatus({ snippet: { title: "Show" }, status: { privacyStatus: "public", lifeCycleStatus: "live" } }),
    ).toEqual({ title: "Show", privacyStatus: "public", isLive: true });
  });

  it("treats liveStarting as live", () => {
    expect(toStatus({ status: { lifeCycleStatus: "liveStarting" } }).isLive).toBe(true);
  });

  it("treats a ready (not-yet-live) broadcast as not live, defaulting missing fields to null", () => {
    expect(toStatus({ status: { lifeCycleStatus: "ready" } })).toEqual({
      title: null,
      privacyStatus: null,
      isLive: false,
    });
  });
});
