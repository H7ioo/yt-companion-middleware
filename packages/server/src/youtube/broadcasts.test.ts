import { describe, expect, it } from "vitest";
import type { youtube_v3 } from "googleapis";
import { resolve } from "../core/resolve.js";
import {
  applyPlan,
  resolveTarget,
  getBroadcast,
  toStatus,
  pickUpcoming,
} from "./broadcasts.js";

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
        else if (params.broadcastStatus === "upcoming")
          items = sets.upcoming ?? [];
        else if (params.broadcastType === "persistent")
          items = sets.persistent ?? [];
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
    const yt = fakeYt({
      upcoming: [{ id: "up-1", status: { lifeCycleStatus: "ready" } }],
    });
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
    await expect(resolveTarget(fakeYt({}))).rejects.toMatchObject({
      code: "NO_TARGET_FOUND",
    });
  });

  it("marks a just-created broadcast starting about now as an auto-start mint", async () => {
    const yt = fakeYt({
      upcoming: [
        {
          id: "minted",
          snippet: {
            scheduledStartTime: hoursAgo(0.01),
            publishedAt: hoursAgo(0.01),
          },
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
          snippet: {
            scheduledStartTime: hoursAhead(2),
            publishedAt: hoursAgo(0.01),
          },
          status: { lifeCycleStatus: "ready" },
        },
      ],
    });
    expect((await resolveTarget(yt, NOW)).autoStartMint).toBe(false);
  });

  it("reports no conflict once live, even with a stray upcoming still around", async () => {
    const yt = fakeYt({
      active: [{ id: "live-1" }],
      upcoming: [
        { id: "ghost", snippet: { scheduledStartTime: hoursAgo(1700) } },
      ],
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
    snippet: {
      title: "stale leftover",
      scheduledStartTime: "2026-05-25T22:16:19Z",
    },
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
    // Both fresh and both scheduled for later, so both survive the staleness filter, neither is
    // an auto-start mint, and the ambiguity is real.
    const alsoFresh = {
      ...ghost,
      snippet: { ...ghost.snippet, scheduledStartTime: hoursAhead(1) },
    };
    const tonight = {
      ...real,
      snippet: { ...real.snippet, scheduledStartTime: hoursAhead(3) },
    };
    const conflict = pickUpcoming([alsoFresh, tonight], NOW)?.conflict;
    expect(conflict?.code).toBe("SHARED_STREAM_KEY");
    expect(conflict?.ids).toEqual(
      expect.arrayContaining(["X8tfFO-lL7w", "kn_lwgeVyNY"]),
    );
  });

  it("flags plain ambiguity when several upcoming use different stream keys", () => {
    const tonight = {
      ...real,
      snippet: { ...real.snippet, scheduledStartTime: hoursAhead(1) },
    };
    const other = {
      id: "other",
      status: { lifeCycleStatus: "ready" },
      snippet: { scheduledStartTime: hoursAhead(2) },
      contentDetails: { boundStreamId: "stream-B" },
    };
    expect(pickUpcoming([tonight, other], NOW)?.conflict?.code).toBe(
      "MULTIPLE_UPCOMING",
    );
  });

  it("stays quiet when the pick is the auto-start mint — that is the show, not ambiguity", () => {
    // `real` is what YouTube mints as the session begins; the operator's own scheduled event is
    // the other id. Telling them to "delete the ones you are not using" seconds before air asks
    // them to delete the real show.
    const scheduled = {
      ...ghost,
      snippet: { ...ghost.snippet, scheduledStartTime: hoursAhead(1) },
    };
    const picked = pickUpcoming([scheduled, real], NOW);
    expect(picked?.chosen.id).toBe("kn_lwgeVyNY");
    expect(picked?.conflict).toBeNull();
  });

  it("picks the freshly minted broadcast over a stray left in testing earlier today", () => {
    // Readiness used to be the first sort key, so a stray already bound to an encoder beat the
    // mint outright — the same miss the past-due rank was added to prevent.
    const strayInTesting = {
      id: "stray",
      status: { lifeCycleStatus: "testing" },
      snippet: { title: "abandoned", scheduledStartTime: hoursAgo(4) },
      contentDetails: { boundStreamId: "stream-A" },
    };
    expect(pickUpcoming([strayInTesting, real], NOW)?.chosen.id).toBe(
      "kn_lwgeVyNY",
    );
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
    expect(pickUpcoming([earlierToday, real], NOW)?.chosen.id).toBe(
      "kn_lwgeVyNY",
    );
  });

  it("prefers the mint over a stray scheduled for later tonight", () => {
    const laterTonight = {
      ...ghost,
      snippet: { ...ghost.snippet, scheduledStartTime: hoursAhead(3) },
    };
    expect(pickUpcoming([laterTonight, real], NOW)?.chosen.id).toBe(
      "kn_lwgeVyNY",
    );
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
    expect(pickUpcoming([thisMorning, justMissed], NOW)?.chosen.id).toBe(
      "just-missed",
    );
  });
});

/**
 * The wrong-container bug with Studio open: liveBroadcasts.list defaults to 5 results per page
 * and does not put the broadcast going to air first, so on a channel carrying a pile of strays
 * the real target never reached pickUpcoming at all.
 */
/**
 * The pin is the operator's answer to the question every ranking rule above is guessing at. It
 * beats the guess outright while it holds, and says so loudly when it stops holding.
 */
describe("resolveTarget with a pinned target", () => {
  const mine = {
    id: "mine",
    status: { lifeCycleStatus: "created" },
    snippet: {
      title: "tonight",
      scheduledStartTime: hoursAhead(4),
      publishedAt: hoursAgo(1),
    },
  };
  const strayThatWouldWin = {
    id: "stray",
    status: { lifeCycleStatus: "testing" },
    snippet: {
      title: "stray",
      scheduledStartTime: hoursAgo(0.01),
      publishedAt: hoursAgo(0.01),
    },
  };

  it("edits the pinned broadcast even when the picker would choose another", async () => {
    const yt = fakeYt({ upcoming: [strayThatWouldWin, mine] });
    // Sanity: unpinned, the mint-shaped stray wins.
    expect((await resolveTarget(yt, NOW)).id).toBe("stray");
    expect((await resolveTarget(yt, NOW, "mine")).id).toBe("mine");
  });

  it("reports no conflict for a pinned target — strays are only ambiguous when guessing", async () => {
    // Two plain scheduled events, neither mint-shaped, so the unpinned path genuinely cannot
    // tell them apart and says so. Pinning one removes the question rather than the strays.
    const other = {
      ...mine,
      id: "other",
      snippet: { ...mine.snippet, title: "other" },
    };
    const yt = fakeYt({ upcoming: [other, mine] });
    expect((await resolveTarget(yt, NOW)).conflict?.code).toBe(
      "MULTIPLE_UPCOMING",
    );
    expect((await resolveTarget(yt, NOW, "mine")).conflict).toBeNull();
  });

  it("still yields to a live broadcast — the encoder decides what is on air, not the pin", async () => {
    const yt = fakeYt({ active: [{ id: "airing" }], upcoming: [mine] });
    expect(await resolveTarget(yt, NOW, "mine")).toMatchObject({
      id: "airing",
      isLive: true,
    });
  });

  it("falls back to the picker and says the pin is gone when it no longer exists", async () => {
    const yt = fakeYt({ upcoming: [strayThatWouldWin] });
    const resolved = await resolveTarget(yt, NOW, "deleted");
    expect(resolved.id).toBe("stray");
    expect(resolved.conflict?.code).toBe("PINNED_TARGET_GONE");
    expect(resolved.conflict?.ids).toContain("deleted");
  });

  it("reports a gone pin against the persistent container when nothing is upcoming", async () => {
    const yt = fakeYt({ persistent: [{ id: "persist-1" }] });
    const resolved = await resolveTarget(yt, NOW, "deleted");
    expect(resolved.id).toBe("persist-1");
    expect(resolved.conflict?.code).toBe("PINNED_TARGET_GONE");
  });

  it("throws NO_TARGET_FOUND when the pin is gone and nothing else exists", async () => {
    await expect(
      resolveTarget(fakeYt({}), NOW, "deleted"),
    ).rejects.toMatchObject({
      code: "NO_TARGET_FOUND",
    });
  });

  it("still reports a shared stream key against a pinned target", async () => {
    // The one warning a pin cannot silence: the encoder feeds exactly one of two broadcasts
    // sharing a key, so pinning the wrong one sends every edit to a broadcast that never airs.
    const bound = { boundStreamId: "key-1" };
    const a = { ...mine, contentDetails: bound };
    const b = {
      ...mine,
      id: "twin",
      contentDetails: bound,
      snippet: { ...mine.snippet, title: "twin" },
    };
    const yt = fakeYt({ upcoming: [a, b] });
    const resolved = await resolveTarget(yt, NOW, "mine");
    expect(resolved.id).toBe("mine");
    expect(resolved.conflict?.code).toBe("SHARED_STREAM_KEY");
    expect(resolved.conflict?.ids).toEqual(
      expect.arrayContaining(["mine", "twin"]),
    );
  });

  it("marks a pinned broadcast that is itself the auto-start mint", async () => {
    const yt = fakeYt({ upcoming: [strayThatWouldWin] });
    expect((await resolveTarget(yt, NOW, "stray")).autoStartMint).toBe(true);
  });
});

describe("listBroadcasts paging", () => {
  /** Serves `pages` in order, recording the params of every call. */
  function pagedYt(pages: youtube_v3.Schema$LiveBroadcast[][]) {
    const calls: youtube_v3.Params$Resource$Livebroadcasts$List[] = [];
    const yt = {
      liveBroadcasts: {
        list: async (
          params: youtube_v3.Params$Resource$Livebroadcasts$List,
        ) => {
          calls.push(params);
          if (params.id) return { data: { items: [] } };
          if (params.broadcastStatus !== "upcoming")
            return { data: { items: [] } };
          const index = params.pageToken ? Number(params.pageToken) : 0;
          const last = index >= pages.length - 1;
          return {
            data: {
              items: pages[index] ?? [],
              nextPageToken: last ? null : String(index + 1),
            },
          };
        },
      },
    } as unknown as youtube_v3.Youtube;
    return { yt, calls };
  }

  const stray = (n: number) => ({
    id: `stray-${n}`,
    status: { lifeCycleStatus: "ready" },
    snippet: { scheduledStartTime: hoursAhead(6), publishedAt: hoursAgo(50) },
  });
  const minted = {
    id: "minted",
    status: { lifeCycleStatus: "ready" },
    snippet: {
      scheduledStartTime: hoursAgo(0.01),
      publishedAt: hoursAgo(0.01),
    },
  };

  it("asks for a full page instead of YouTube's default of 5", async () => {
    const { yt, calls } = pagedYt([[minted]]);
    await resolveTarget(yt, NOW);
    expect(calls.every((c) => c.maxResults === 50)).toBe(true);
  });

  it("follows nextPageToken, so a target beyond page 1 is still a candidate", async () => {
    const { yt } = pagedYt([
      [stray(1), stray(2)],
      [stray(3), minted],
    ]);
    expect((await resolveTarget(yt, NOW)).id).toBe("minted");
  });

  it("stops after 4 pages rather than walking a channel of strays forever", async () => {
    const { yt, calls } = pagedYt(
      Array.from({ length: 12 }, (_, n) => [stray(n)]),
    );
    await resolveTarget(yt, NOW);
    const upcomingCalls = calls.filter((c) => c.broadcastStatus === "upcoming");
    expect(upcomingCalls).toHaveLength(4);
  });
});

describe("getBroadcast", () => {
  it("returns the single item for the id", async () => {
    const yt = fakeYt({ byId: [{ id: "v1", snippet: { title: "Hi" } }] });
    expect((await getBroadcast(yt, "v1")).id).toBe("v1");
  });

  it("throws NO_TARGET_FOUND when the id is absent", async () => {
    await expect(
      getBroadcast(fakeYt({ byId: [] }), "gone"),
    ).rejects.toMatchObject({
      code: "NO_TARGET_FOUND",
    });
  });
});

describe("toStatus", () => {
  it("reads title and privacy, and treats a live lifecycle as live", () => {
    expect(
      toStatus({
        id: "b1",
        snippet: { title: "Show" },
        status: { privacyStatus: "public", lifeCycleStatus: "live" },
      }),
    ).toEqual({ broadcastId: "b1", title: "Show", privacyStatus: "public", isLive: true });
  });

  // The id is what a watch link is built from (issue 065): "public and live" says a player may
  // be embedded, and says nothing about which video to embed.
  it("carries the broadcast id, so a surface can link to the video it describes", () => {
    expect(toStatus({ id: "abc123" }).broadcastId).toBe("abc123");
  });

  it("treats liveStarting as live", () => {
    expect(
      toStatus({ status: { lifeCycleStatus: "liveStarting" } }).isLive,
    ).toBe(true);
  });

  it("treats a ready (not-yet-live) broadcast as not live, defaulting missing fields to null", () => {
    expect(toStatus({ status: { lifeCycleStatus: "ready" } })).toEqual({
      broadcastId: null,
      title: null,
      privacyStatus: null,
      isLive: false,
    });
  });
});

describe("applyPlan (issue 056 — one guarded write path)", () => {
  const current = {
    id: "b1",
    snippet: { title: "Old", description: "Keep me" },
    status: { privacyStatus: "unlisted" },
    contentDetails: {
      boundStreamId: "s1",
      monitorStream: { enableMonitorStream: true, broadcastStreamDelayMs: 0 },
      enableAutoStart: true,
    },
  };

  function updateRecordingYt() {
    const bodies: unknown[] = [];
    const yt = {
      liveBroadcasts: {
        update: async (p: { requestBody?: unknown }) => {
          bodies.push(p.requestBody);
          return { data: {} };
        },
      },
    } as unknown as youtube_v3.Youtube;
    return { yt, bodies };
  }

  it("sends the merged resource with every un-owned field intact", async () => {
    const plan = resolve(current, { title: "New" }, {
      defaultCategory: null,
      defaultStreamBoundId: null,
    });
    const { yt, bodies } = updateRecordingYt();
    await applyPlan(yt, plan);

    expect(bodies[0]).toEqual({
      ...current,
      snippet: { title: "New", description: "Keep me" },
    });
  });

  it("refuses a plan whose merged broadcast lost a field", async () => {
    const plan = resolve(current, { title: "New" }, {
      defaultCategory: null,
      defaultStreamBoundId: null,
    });
    delete (plan.broadcast.contentDetails as Record<string, unknown>).enableAutoStart;

    const { yt, bodies } = updateRecordingYt();
    await expect(applyPlan(yt, plan)).rejects.toThrow(/enableAutoStart/);
    expect(bodies).toHaveLength(0);
  });
});
