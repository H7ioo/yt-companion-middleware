import { describe, expect, it } from "vitest";
import { listWhatWillAir } from "./willAir.js";

describe("listWhatWillAir", () => {
  it("marks the broadcast already on air — nothing else can win", () => {
    const listing = listWhatWillAir({
      active: [
        {
          id: "on-air",
          snippet: { title: "tonight's show" },
          status: { lifeCycleStatus: "live" },
        },
      ],
      upcoming: [],
      streams: [],
      defaultStreamBoundId: null,
    });

    const marked = listing.entries.filter((e) => e.willAir);
    expect(marked.map((e) => e.id)).toEqual(["on-air"]);
    expect(marked[0].reason).toBe("On air now — this is what viewers are watching.");
  });

  it("marks the upcoming broadcast bound to the encoder's key with auto-start on", () => {
    const listing = listWhatWillAir({
      active: [],
      upcoming: [
        {
          id: "tonight",
          snippet: { title: "tonight's show", scheduledStartTime: "2026-08-05T22:00:00Z" },
          status: { lifeCycleStatus: "ready", privacyStatus: "public" },
          contentDetails: { boundStreamId: "stream-A", enableAutoStart: true },
        },
      ],
      streams: [{ id: "stream-A", title: "OBS key", streamName: "abcd-efgh" }],
      defaultStreamBoundId: "stream-A",
    });

    const marked = listing.entries.filter((e) => e.willAir);
    expect(marked.map((e) => e.id)).toEqual(["tonight"]);
    expect(marked[0].reason).toBe(
      "Bound to “OBS key” — the key the encoder pushes to — with auto-start on, so YouTube starts it when the encoder does.",
    );
  });

  it("marks nothing, and says why each one is out, when none qualifies", () => {
    const listing = listWhatWillAir({
      active: [],
      upcoming: [
        {
          id: "no-autostart",
          snippet: { title: "auto-start off" },
          contentDetails: { boundStreamId: "stream-A", enableAutoStart: false },
        },
        {
          id: "other-key",
          snippet: { title: "wrong key" },
          contentDetails: { boundStreamId: "stream-B", enableAutoStart: true },
        },
        { id: "unbound", snippet: { title: "not attached" }, contentDetails: {} },
      ],
      streams: [
        { id: "stream-A", title: "OBS key", streamName: "abcd" },
        { id: "stream-B", title: "Spare key", streamName: "efgh" },
      ],
      defaultStreamBoundId: "stream-A",
    });

    expect(listing.entries.some((e) => e.willAir)).toBe(false);
    expect(listing.verdict).toBe(
      "Nothing will air on its own. No upcoming broadcast is both attached to “OBS key” and set to auto-start, so starting the encoder makes YouTube create a broadcast of its own.",
    );
    expect(byId(listing, "no-autostart").reason).toBe(
      "Attached to the encoder's key, but auto-start is off — it waits for someone to press Go live.",
    );
    expect(byId(listing, "other-key").reason).toBe(
      "Attached to “Spare key”, not the key the encoder pushes to.",
    );
    expect(byId(listing, "unbound").reason).toBe(
      "Not attached to any ingestion key, so no encoder can feed it.",
    );
  });

  it("flags both when two broadcasts compete for the same key, rather than letting one win", () => {
    const listing = listWhatWillAir({
      active: [],
      upcoming: [
        {
          id: "tonight",
          snippet: { title: "tonight's show", scheduledStartTime: "2026-08-05T22:00:00Z" },
          contentDetails: { boundStreamId: "stream-A", enableAutoStart: true },
        },
        {
          id: "stray",
          snippet: { title: "leftover from Tuesday", scheduledStartTime: "2026-08-05T23:00:00Z" },
          contentDetails: { boundStreamId: "stream-A", enableAutoStart: true },
        },
      ],
      streams: [{ id: "stream-A", title: "OBS key", streamName: "abcd" }],
      defaultStreamBoundId: "stream-A",
    });

    expect(listing.entries.filter((e) => e.willAir).map((e) => e.id).sort()).toEqual([
      "stray",
      "tonight",
    ]);
    expect(listing.contested).toBe(true);
    expect(listing.verdict).toBe(
      "2 broadcasts are attached to “OBS key” with auto-start on. The encoder can only feed one, and YouTube — not this app — decides which. Delete the ones you are not using.",
    );
    expect(byId(listing, "tonight").reason).toBe(
      "Competing for “OBS key” with 1 other auto-start broadcast — only one of them airs.",
    );
  });

  it("infers the encoder's key when the channel has exactly one, with no default set", () => {
    const listing = listWhatWillAir({
      active: [],
      upcoming: [
        {
          id: "tonight",
          snippet: { title: "tonight's show" },
          contentDetails: { boundStreamId: "stream-A", enableAutoStart: true },
        },
      ],
      streams: [{ id: "stream-A", title: "OBS key", streamName: "abcd" }],
      defaultStreamBoundId: null,
    });

    expect(listing.encoderStreamId).toBe("stream-A");
    expect(listing.encoderSource).toBe("only-key");
    expect(listing.entries.filter((e) => e.willAir).map((e) => e.id)).toEqual(["tonight"]);
  });

  it("marks nothing when several keys exist and none is chosen — an unattached broadcast is not a match", () => {
    const listing = listWhatWillAir({
      active: [],
      upcoming: [
        {
          id: "unbound",
          snippet: { title: "not attached" },
          contentDetails: { enableAutoStart: true },
        },
      ],
      streams: [
        { id: "stream-A", title: "OBS key", streamName: "abcd" },
        { id: "stream-B", title: "Spare key", streamName: "efgh" },
      ],
      defaultStreamBoundId: null,
    });

    expect(listing.encoderSource).toBe("unknown");
    expect(listing.entries.some((e) => e.willAir)).toBe(false);
    expect(listing.verdict).toBe(
      "This channel has 2 ingestion keys and none is set as the default, so the app cannot say which broadcast will air. Set the default stream in Settings to the key OBS pushes to.",
    );
  });
});

/**
 * The recorded shapes from the real sessions. The 2026-08-05 failure has a mundane cause,
 * confirmed by the operator: the scheduled broadcast was never attached to the key OBS was
 * pushing to, so YouTube minted `3u1qu4bOxxM` to receive the video. This list is the readout
 * that would have said so before the show rather than after it.
 */
describe("listWhatWillAir against the recorded sessions", () => {
  const streams = [{ id: "stream-A", title: "OBS key", streamName: "abcd-efgh" }];

  it("2026-08-05: says nothing will air, because the scheduled event is on no key", () => {
    const listing = listWhatWillAir({
      active: [],
      upcoming: [
        {
          id: "X8tfFO-lL7w",
          snippet: {
            title: "stale leftover",
            scheduledStartTime: "2026-05-25T22:16:19Z",
          },
          status: { lifeCycleStatus: "ready", privacyStatus: "public" },
          contentDetails: {},
        },
      ],
      streams,
      defaultStreamBoundId: "stream-A",
    });

    expect(listing.entries.some((e) => e.willAir)).toBe(false);
    expect(listing.verdict).toContain("Nothing will air on its own");
    expect(byId(listing, "X8tfFO-lL7w").reason).toBe(
      "Not attached to any ingestion key, so no encoder can feed it.",
    );
  });

  it("August re-test: the correctly attached event is the one that will air", () => {
    const listing = listWhatWillAir({
      active: [],
      upcoming: [
        {
          id: "X8tfFO-lL7w",
          snippet: {
            title: "stale leftover",
            scheduledStartTime: "2026-05-25T22:16:19Z",
          },
          status: { lifeCycleStatus: "ready", privacyStatus: "public" },
          contentDetails: {},
        },
        {
          id: "kn_lwgeVyNY",
          snippet: {
            title: "tonight's show",
            scheduledStartTime: "2026-08-05T21:49:00Z",
          },
          status: { lifeCycleStatus: "ready", privacyStatus: "public" },
          contentDetails: { boundStreamId: "stream-A", enableAutoStart: true },
        },
      ],
      streams,
      defaultStreamBoundId: "stream-A",
    });

    expect(listing.entries.filter((e) => e.willAir).map((e) => e.id)).toEqual([
      "kn_lwgeVyNY",
    ]);
    expect(listing.contested).toBe(false);
    expect(listing.verdict).toContain("“tonight's show” will air");
  });

  it("once it is on air, the live broadcast is the answer and no upcoming row competes", () => {
    const listing = listWhatWillAir({
      active: [
        {
          id: "3u1qu4bOxxM",
          snippet: { title: "YouTube's own mint" },
          status: { lifeCycleStatus: "live", privacyStatus: "public" },
          contentDetails: { boundStreamId: "stream-A", enableAutoStart: true },
        },
      ],
      upcoming: [
        {
          id: "kn_lwgeVyNY",
          snippet: { title: "tonight's show" },
          contentDetails: { boundStreamId: "stream-A", enableAutoStart: true },
        },
      ],
      streams,
      defaultStreamBoundId: "stream-A",
    });

    expect(listing.entries.filter((e) => e.willAir).map((e) => e.id)).toEqual([
      "3u1qu4bOxxM",
    ]);
    expect(listing.contested).toBe(false);
    expect(listing.verdict).toContain("On air now");
  });

  it("orders the list live first, then the one that will air, then by how soon it starts", () => {
    const at = (iso: string, id: string) => ({
      id,
      snippet: { title: id, scheduledStartTime: iso },
      contentDetails: { boundStreamId: id === "airs" ? "stream-A" : "stream-B", enableAutoStart: true },
    });
    const listing = listWhatWillAir({
      active: [],
      upcoming: [
        at("2026-08-06T20:00:00Z", "later"),
        at("2026-08-05T22:00:00Z", "airs"),
        at("2026-08-05T21:55:00Z", "sooner"),
        { id: "no-time", snippet: { title: "no-time" }, contentDetails: {} },
      ],
      streams,
      defaultStreamBoundId: "stream-A",
    });

    expect(listing.entries.map((e) => e.id)).toEqual([
      "airs",
      "sooner",
      "later",
      "no-time",
    ]);
  });

  it("does not blame the wrong key when it does not know which key is the encoder's", () => {
    const listing = listWhatWillAir({
      active: [],
      upcoming: [
        {
          id: "bound",
          snippet: { title: "bound somewhere" },
          contentDetails: { boundStreamId: "stream-B", enableAutoStart: true },
        },
      ],
      streams: [
        { id: "stream-A", title: "OBS key", streamName: "abcd" },
        { id: "stream-B", title: "Spare key", streamName: "efgh" },
      ],
      defaultStreamBoundId: null,
    });

    expect(byId(listing, "bound").reason).toBe(
      "Attached to “Spare key” with auto-start on. Whether that is the key the encoder pushes to is not something the app has been told.",
    );
  });

  it("names the live broadcast even when the encoder's key is unknown — it is already airing", () => {
    const listing = listWhatWillAir({
      active: [{ id: "on-air", snippet: { title: "tonight's show" } }],
      upcoming: [],
      streams: [
        { id: "stream-A", title: "OBS key", streamName: "abcd" },
        { id: "stream-B", title: "Spare key", streamName: "efgh" },
      ],
      defaultStreamBoundId: null,
    });

    expect(listing.encoderSource).toBe("unknown");
    expect(listing.verdict).toContain("“tonight's show” will air");
  });
});

describe("listWhatWillAir where the encoder's key is the pivot", () => {
  const twoKeys = [
    { id: "stream-A", title: "OBS key", streamName: "abcd" },
    { id: "stream-B", title: "Spare key", streamName: "efgh" },
  ];

  it("does not let a broadcast live on another key suppress the one the encoder will start", () => {
    // A second encoder is feeding key B. Starting OBS — which pushes to key A — airs the
    // upcoming event, so "waiting, something is already on air" would be a lie that hides it.
    const listing = listWhatWillAir({
      active: [
        {
          id: "other-encoder",
          snippet: { title: "the other room" },
          status: { lifeCycleStatus: "live" },
          contentDetails: { boundStreamId: "stream-B" },
        },
      ],
      upcoming: [
        {
          id: "tonight",
          snippet: { title: "tonight's show" },
          contentDetails: { boundStreamId: "stream-A", enableAutoStart: true },
        },
      ],
      streams: twoKeys,
      defaultStreamBoundId: "stream-A",
    });

    expect(byId(listing, "tonight").willAir).toBe(true);
    expect(listing.verdict).toBe(
      "“the other room” is on air now, on a different ingestion key. Starting the encoder also airs “tonight's show”, which is attached to “OBS key” with auto-start on.",
    );
  });

  it("still suppresses the upcoming rows when the live broadcast is on the encoder's own key", () => {
    const listing = listWhatWillAir({
      active: [
        {
          id: "on-air",
          snippet: { title: "tonight's show" },
          contentDetails: { boundStreamId: "stream-A" },
        },
      ],
      upcoming: [
        {
          id: "waiting",
          snippet: { title: "the next one" },
          contentDetails: { boundStreamId: "stream-A", enableAutoStart: true },
        },
      ],
      streams: twoKeys,
      defaultStreamBoundId: "stream-A",
    });

    expect(listing.entries.filter((e) => e.willAir).map((e) => e.id)).toEqual(["on-air"]);
    expect(byId(listing, "waiting").reason).toBe(
      "Waiting — the encoder is already feeding the broadcast on air.",
    );
  });

  it("calls two simultaneously-live broadcasts contested rather than marking both as the answer", () => {
    const listing = listWhatWillAir({
      active: [
        { id: "one", snippet: { title: "first" }, contentDetails: { boundStreamId: "stream-A" } },
        { id: "two", snippet: { title: "second" }, contentDetails: { boundStreamId: "stream-B" } },
      ],
      upcoming: [],
      streams: twoKeys,
      defaultStreamBoundId: "stream-A",
    });

    expect(listing.contested).toBe(true);
    expect(listing.verdict).toBe(
      "2 broadcasts are on air at once — “first”, “second”. Only one of them is the one your encoder is feeding, and the app cannot tell which. End the others in YouTube Studio.",
    );
  });

  it("reports a default stream setting that names a key the channel no longer has", () => {
    const listing = listWhatWillAir({
      active: [],
      upcoming: [
        {
          id: "tonight",
          snippet: { title: "tonight's show" },
          contentDetails: { boundStreamId: "stream-A", enableAutoStart: true },
        },
      ],
      streams: twoKeys,
      defaultStreamBoundId: "dead-key",
    });

    expect(listing.encoderSource).toBe("dangling");
    expect(listing.encoderStreamId).toBe(null);
    expect(listing.entries.some((e) => e.willAir)).toBe(false);
    expect(listing.verdict).toBe(
      "The default ingestion key in Settings (“dead-key”) is not one of this channel's 2 keys — it was deleted or belongs to another channel — so the app cannot say which broadcast will air. Pick the key the encoder pushes to in Settings.",
    );
  });

  it("does not tell a channel with no ingestion keys to pick one as the default", () => {
    const listing = listWhatWillAir({
      active: [],
      upcoming: [{ id: "tonight", snippet: { title: "tonight's show" }, contentDetails: {} }],
      streams: [],
      defaultStreamBoundId: null,
    });

    expect(listing.verdict).toBe(
      "This channel has no ingestion keys, so there is nothing for an encoder to push to. Create a stream in YouTube Studio (Go live → Stream), then set it as the default in Settings.",
    );
  });
});

function byId(listing: { entries: { id: string }[] }, id: string) {
  const found = listing.entries.find((e) => e.id === id);
  if (!found) throw new Error(`no entry ${id}`);
  return found as { id: string; reason: string; willAir: boolean };
}
