import { describe, expect, it, vi } from "vitest";
import type { youtube_v3 } from "googleapis";
import { AppError } from "../core/errors.js";
import { buildInsertBody, prepareBroadcast, watchUrlFor, type PrepareInput } from "./prepare.js";

const INPUT: PrepareInput = {
  title: "Friday night",
  description: "Doors at 7",
  privacyStatus: "unlisted",
  scheduledStartTime: "2026-09-04T18:00:00.000Z",
  streamId: "stream-9",
  categoryId: null,
  presetId: null,
};

/**
 * A fake client that records what each call was asked to do. `liveStreams.insert` is present and
 * always throws: creating a key would mean re-pasting it into OBS, so a test that never notices
 * the call is worse than no test.
 */
function fakeYt(over: {
  insert?: (params: unknown) => unknown;
  bind?: (params: unknown) => unknown;
} = {}) {
  const calls: Array<{ method: string; params: any }> = [];
  const yt = {
    liveBroadcasts: {
      insert: vi.fn(async (params: any) => {
        calls.push({ method: "liveBroadcasts.insert", params });
        if (over.insert) return over.insert(params);
        return { data: { id: "new-1", ...(params.requestBody ?? {}) } };
      }),
      bind: vi.fn(async (params: any) => {
        calls.push({ method: "liveBroadcasts.bind", params });
        if (over.bind) return over.bind(params);
        return { data: { id: params.id, contentDetails: { boundStreamId: params.streamId } } };
      }),
    },
    liveStreams: {
      insert: vi.fn(async () => {
        throw new Error("liveStreams.insert must never be called — OBS already holds a key");
      }),
    },
    videos: {
      list: vi.fn(async () => ({ data: { items: [{ snippet: { title: "Friday night" } }] } })),
      update: vi.fn(async (params: any) => {
        calls.push({ method: "videos.update", params });
        return { data: {} };
      }),
    },
  };
  return { yt: yt as unknown as youtube_v3.Youtube, spy: yt, calls };
}

/** googleapis' shape for the refusal an ineligible channel gets from insert. */
function refusal(reason: string) {
  return Object.assign(new Error(`Forbidden: ${reason}`), {
    response: { status: 403, data: { error: { errors: [{ reason }] } } },
  });
}

describe("buildInsertBody", () => {
  it("carries the operator's metadata into the insert itself, not a later patch", () => {
    const body = buildInsertBody(INPUT);
    expect(body.snippet).toMatchObject({
      title: "Friday night",
      description: "Doors at 7",
      scheduledStartTime: "2026-09-04T18:00:00.000Z",
    });
    expect(body.status?.privacyStatus).toBe("unlisted");
  });

  it("sets auto-start and auto-stop, so the encoder alone puts the show on air", () => {
    const body = buildInsertBody(INPUT);
    expect(body.contentDetails?.enableAutoStart).toBe(true);
    expect(body.contentDetails?.enableAutoStop).toBe(true);
  });

  it("declares the broadcast not made for kids, which YouTube requires at insert", () => {
    expect(buildInsertBody(INPUT).status?.selfDeclaredMadeForKids).toBe(false);
  });
});

describe("watchUrlFor", () => {
  it("is the link the audience gets, ready to copy", () => {
    expect(watchUrlFor("abc123")).toBe("https://www.youtube.com/watch?v=abc123");
  });
});

describe("prepareBroadcast", () => {
  it("inserts, then binds the existing key — and never creates a stream", async () => {
    const { yt, spy, calls } = fakeYt();
    const record = await prepareBroadcast(yt, INPUT, { now: "2026-09-03T10:00:00.000Z" });

    expect(calls.map((c) => c.method)).toEqual(["liveBroadcasts.insert", "liveBroadcasts.bind"]);
    expect(calls[1].params).toMatchObject({ id: "new-1", streamId: "stream-9" });
    expect(spy.liveStreams.insert).not.toHaveBeenCalled();
    expect(record).toMatchObject({
      id: "new-1",
      title: "Friday night",
      privacyStatus: "unlisted",
      scheduledStartTime: "2026-09-04T18:00:00.000Z",
      streamId: "stream-9",
      watchUrl: "https://www.youtube.com/watch?v=new-1",
      createdAt: "2026-09-03T10:00:00.000Z",
      presetId: null,
    });
  });

  it("sets the category on the video resource, where the field actually lives", async () => {
    const { yt, calls } = fakeYt();
    await prepareBroadcast(yt, { ...INPUT, categoryId: "24" }, { now: "2026-09-03T10:00:00.000Z" });
    const video = calls.find((c) => c.method === "videos.update");
    expect(video?.params.requestBody.snippet.categoryId).toBe("24");
    expect(video?.params.requestBody.id).toBe("new-1");
  });

  it("leaves the category alone when none was resolved", async () => {
    const { yt, spy } = fakeYt();
    await prepareBroadcast(yt, INPUT, { now: "2026-09-03T10:00:00.000Z" });
    expect(spy.videos.update).not.toHaveBeenCalled();
  });

  it("records ownership before the bind, so a failed bind still leaves a cleanable broadcast", async () => {
    const seen: string[] = [];
    const { yt } = fakeYt({
      bind: () => {
        throw new Error("bind exploded");
      },
    });
    await expect(
      prepareBroadcast(yt, INPUT, {
        now: "2026-09-03T10:00:00.000Z",
        onCreated: async (rec) => {
          seen.push(rec.id);
        },
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(seen).toEqual(["new-1"]);
  });

  it("surfaces a refused insert as riding mode rather than a raw YouTube error", async () => {
    const { yt } = fakeYt({
      insert: () => {
        throw refusal("livePermissionBlocked");
      },
    });
    const err = await prepareBroadcast(yt, INPUT, { now: "2026-09-03T10:00:00.000Z" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("LIVE_NOT_ELIGIBLE");
    expect(err.reason).toBe("livePermissionBlocked");
  });

  it("refuses an insert that YouTube answered without an id — there is nothing to bind", async () => {
    const { yt } = fakeYt({ insert: () => ({ data: {} }) });
    await expect(
      prepareBroadcast(yt, INPUT, { now: "2026-09-03T10:00:00.000Z" }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
