import { describe, expect, it } from "vitest";
import type { youtube_v3 } from "googleapis";
import { writeBroadcast } from "./broadcastWrite.js";
import type { BroadcastResource } from "../core/resolve.js";

/**
 * A broadcast with every field the app does *not* own populated. The point of the whole
 * module is that all of this survives an edit to one field it does own.
 */
function fullyPopulated(): BroadcastResource {
  return {
    id: "bcast-1",
    etag: "etag-1",
    kind: "youtube#liveBroadcast",
    snippet: {
      title: "Tonight's show",
      description: "The long description nobody wants to retype.",
      scheduledStartTime: "2026-09-01T19:00:00Z",
      thumbnails: { default: { url: "https://x/y.jpg" } },
      channelId: "chan-1",
    },
    status: {
      privacyStatus: "unlisted",
      lifeCycleStatus: "ready",
      recordingStatus: "notRecording",
      selfDeclaredMadeForKids: false,
    },
    contentDetails: {
      boundStreamId: "stream-1",
      monitorStream: { enableMonitorStream: false, broadcastStreamDelayMs: 0 },
      enableDvr: true,
      recordFromStart: true,
      enableAutoStart: true,
      enableAutoStop: false,
      enableClosedCaptions: false,
      latencyPreference: "low",
    },
  };
}

/** Captures what the production code sends to liveBroadcasts.update. */
function recordingYt() {
  const calls: youtube_v3.Params$Resource$Livebroadcasts$Update[] = [];
  const yt = {
    liveBroadcasts: {
      update: async (
        params: youtube_v3.Params$Resource$Livebroadcasts$Update,
      ) => {
        calls.push(params);
        return { data: params.requestBody ?? {} };
      },
    },
  } as unknown as youtube_v3.Youtube;
  return { yt, calls };
}

describe("writeBroadcast", () => {
  it("sends the whole resource back, changing only the edited field", async () => {
    const current = fullyPopulated();
    const next = structuredClone(current);
    next.snippet!.title = "A new title";

    const { yt, calls } = recordingYt();
    await writeBroadcast(yt, current, next);

    expect(calls).toHaveLength(1);
    const body = calls[0].requestBody as BroadcastResource;
    expect(body.snippet?.title).toBe("A new title");
    // Everything else, field for field, exactly as it came off the GET.
    expect({ ...body, snippet: { ...body.snippet, title: undefined } }).toEqual({
      ...current,
      snippet: { ...current.snippet, title: undefined },
    });
  });
});

describe("writeBroadcast — dropped fields", () => {
  it("refuses a body that has lost a field the fetched resource had", async () => {
    const current = fullyPopulated();
    const next = structuredClone(current);
    delete (next.contentDetails as Record<string, unknown>).enableAutoStart;

    const { yt, calls } = recordingYt();
    await expect(writeBroadcast(yt, current, next)).rejects.toThrow(
      /contentDetails\.enableAutoStart/,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("writeBroadcast — monitorStream", () => {
  it("re-sends the fetched monitorStream untouched", async () => {
    const current = fullyPopulated();
    const { yt, calls } = recordingYt();
    await writeBroadcast(yt, current, structuredClone(current));

    const body = calls[0].requestBody as BroadcastResource;
    expect(body.contentDetails?.monitorStream).toEqual({
      enableMonitorStream: false,
      broadcastStreamDelayMs: 0,
    });
  });

  it("supplies YouTube's defaults when the fetched resource carried none", async () => {
    const current = fullyPopulated();
    delete (current.contentDetails as Record<string, unknown>).monitorStream;
    const { yt, calls } = recordingYt();
    await writeBroadcast(yt, current, structuredClone(current));

    const body = calls[0].requestBody as BroadcastResource;
    expect(body.contentDetails?.monitorStream).toEqual({
      enableMonitorStream: true,
      broadcastStreamDelayMs: 0,
    });
  });
});
