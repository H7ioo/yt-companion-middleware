import { describe, expect, it } from "vitest";
import { applyBroadcastEdit } from "./broadcastEdit.js";
import type { BroadcastResource } from "../core/resolve.js";

const existing: BroadcastResource = {
  id: "b1",
  snippet: {
    title: "Sunday service",
    description: "the usual",
    scheduledStartTime: "2026-09-06T18:00:00.000Z",
  },
  status: { privacyStatus: "public", lifeCycleStatus: "ready" },
  contentDetails: { boundStreamId: "s1", enableAutoStart: true, enableDvr: true },
};

describe("applyBroadcastEdit", () => {
  it("changes one field and re-sends the rest, so the write cannot delete what it did not touch", () => {
    const next = applyBroadcastEdit(existing, { title: "Harvest service" });
    expect(next.snippet?.title).toBe("Harvest service");
    expect(next.snippet?.description).toBe("the usual");
    expect(next.snippet?.scheduledStartTime).toBe("2026-09-06T18:00:00.000Z");
    expect(next.status?.privacyStatus).toBe("public");
    expect(next.contentDetails?.enableDvr).toBe(true);
  });

  it("leaves the fetched resource alone, so a refused write has something honest to compare against", () => {
    applyBroadcastEdit(existing, { title: "Harvest service" });
    expect(existing.snippet?.title).toBe("Sunday service");
  });

  it("carries through fields this app has never heard of, which is what writeBroadcast checks for", () => {
    const withExtras: BroadcastResource = {
      ...existing,
      // A field this repo does not model. `liveBroadcasts.update` is a PUT, so dropping it here
      // would delete it from the resource — and writeBroadcast refuses exactly this.
      statistics: { totalChatCount: "12" },
      snippet: { ...existing.snippet, thumbnails: { default: { url: "https://x/y.jpg" } } },
    };
    const next = applyBroadcastEdit(withExtras, { privacyStatus: "private" });
    expect(next.statistics).toEqual({ totalChatCount: "12" });
    expect(next.snippet?.thumbnails).toEqual({ default: { url: "https://x/y.jpg" } });
    expect(next.status?.privacyStatus).toBe("private");
  });

  it("re-sends the whole monitorStream object when only its flag is edited", () => {
    const current: BroadcastResource = {
      ...existing,
      contentDetails: { monitorStream: { enableMonitorStream: true, broadcastStreamDelayMs: 30 } },
    };
    const next = applyBroadcastEdit(current, { enableMonitorStream: false });
    // The delay rides along: `part=contentDetails` resets every property the object omits.
    expect(next.contentDetails?.monitorStream).toEqual({
      enableMonitorStream: false,
      broadcastStreamDelayMs: 30,
    });
  });
});
