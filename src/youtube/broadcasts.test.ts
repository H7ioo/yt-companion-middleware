import { describe, expect, it } from "vitest";
import type { youtube_v3 } from "googleapis";
import { resolveTarget, getBroadcast, toStatus } from "./broadcasts.js";

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
    expect(await resolveTarget(yt)).toEqual({ id: "live-1", isLive: true });
  });

  it("falls back to upcoming when nothing is active (not live)", async () => {
    const yt = fakeYt({ upcoming: [{ id: "up-1", status: { lifeCycleStatus: "ready" } }] });
    expect(await resolveTarget(yt)).toEqual({ id: "up-1", isLive: false });
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
    expect(await resolveTarget(yt)).toEqual({ id: "persist-1", isLive: false });
  });

  it("throws NO_TARGET_FOUND when nothing exists", async () => {
    await expect(resolveTarget(fakeYt({}))).rejects.toMatchObject({ code: "NO_TARGET_FOUND" });
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
