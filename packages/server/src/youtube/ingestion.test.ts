import { describe, it, expect, vi } from "vitest";
import type { youtube_v3 } from "googleapis";
import { readIngestion, toIngestionSnapshot } from "./ingestion.js";

const AT = "2026-09-02T18:00:00.000Z";

function fakeYt(items: unknown[] | Error) {
  const list = vi.fn(async (_params?: youtube_v3.Params$Resource$Livestreams$List) => {
    if (items instanceof Error) throw items;
    return { data: { items } };
  });
  return { yt: { liveStreams: { list } } as unknown as youtube_v3.Youtube, list };
}

describe("toIngestionSnapshot", () => {
  it("reads the two status fields and the configuration issues off the resource", () => {
    const snap = toIngestionSnapshot(
      {
        id: "S1",
        snippet: { title: "Main key" },
        status: {
          streamStatus: "active",
          healthStatus: {
            status: "bad",
            configurationIssues: [
              { severity: "warning", reason: "variableBitrate", description: "Your bitrate varies." },
            ],
          },
        },
      },
      AT,
    );
    expect(snap).toEqual({
      streamId: "S1",
      streamTitle: "Main key",
      streamStatus: "active",
      healthStatus: "bad",
      issues: [
        { severity: "warning", reason: "variableBitrate", description: "Your bitrate varies." },
      ],
      checkedAt: AT,
    });
  });

  it("survives a resource with no status at all rather than inventing one", () => {
    const snap = toIngestionSnapshot({ id: "S1" }, AT);
    expect(snap.streamStatus).toBeNull();
    expect(snap.healthStatus).toBeNull();
    expect(snap.issues).toEqual([]);
    // No title is not "untitled" — the key's own id is the only honest name for it.
    expect(snap.streamTitle).toBe("S1");
  });
});

describe("readIngestion", () => {
  it("asks YouTube for exactly one key's status — one read unit, not a walk of every key", async () => {
    const { yt, list } = fakeYt([{ id: "S1", status: { streamStatus: "ready" } }]);
    const snap = await readIngestion(yt, "S1", AT);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0]?.[0]).toMatchObject({ id: ["S1"], part: ["snippet", "status"] });
    expect(snap?.streamStatus).toBe("ready");
  });

  it("returns null for a key the channel no longer has, rather than a reading about nothing", async () => {
    const { yt } = fakeYt([]);
    expect(await readIngestion(yt, "GONE", AT)).toBeNull();
  });

  it("leaves an API failure raw for the caller to map", async () => {
    const { yt } = fakeYt(new Error("boom"));
    await expect(readIngestion(yt, "S1", AT)).rejects.toThrow("boom");
  });
});
