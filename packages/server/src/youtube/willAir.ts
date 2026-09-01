import type { youtube_v3 } from "googleapis";

// The list shapes are part of the shared API contract (the dashboard's broadcast list).
export type { BroadcastListEntry, BroadcastListing } from "@app/shared";
import type { BroadcastListEntry, BroadcastListing, StreamInfo } from "@app/shared";

/**
 * The listing minus what only the caller can know: the quota it cost. Keeping that out of the
 * pure function is what lets the whole ranking be tested without a clock or an API client.
 */
export type WillAirResult = Omit<BroadcastListing, "quotaUnits">;

export interface WillAirInput {
  /** Broadcasts YouTube reports as `active` — already on air. */
  active: youtube_v3.Schema$LiveBroadcast[];
  /** Broadcasts YouTube reports as `upcoming`. */
  upcoming: youtube_v3.Schema$LiveBroadcast[];
  /** The channel's ingestion keys, used to name the bound stream rather than print an id. */
  streams: StreamInfo[];
  /** The key this app binds to by default — the operator's statement of what OBS pushes to. */
  defaultStreamBoundId: string | null;
  now: number;
}

/**
 * Answers "which of these will actually air?" over an already-fetched broadcast list.
 *
 * Pure on purpose: the ranking is the whole feature, and the only honest way to pin it is
 * against the recorded shapes from real go-lives rather than against a live channel.
 */
export function listWhatWillAir(input: WillAirInput): WillAirResult {
  // Which key the encoder pushes to is the pivot of the whole answer, and the app is only ever
  // *told* it by the operator's default binding. A channel with exactly one ingestion key needs
  // no telling — there is nothing else OBS could be pointed at — but two keys and no setting is
  // a genuine unknown, and guessing there would put a confident marker on a coin flip.
  const encoderSource: WillAirResult["encoderSource"] = input.defaultStreamBoundId
    ? "setting"
    : input.streams.length === 1
      ? "only-key"
      : "unknown";
  const encoderStreamId =
    encoderSource === "setting"
      ? input.defaultStreamBoundId
      : encoderSource === "only-key"
        ? input.streams[0].id
        : null;

  const contenders = encoderStreamId
    ? input.upcoming.filter(
        (b) =>
          b.contentDetails?.boundStreamId === encoderStreamId &&
          b.contentDetails?.enableAutoStart === true,
      )
    : [];
  // A live broadcast settles the question outright: the encoder is already feeding it, so a
  // contest among upcoming events is moot until it ends.
  const onAir = input.active.length > 0;
  const contested = !onAir && contenders.length > 1;

  const entries: BroadcastListEntry[] = [
    ...input.active.map(
      (b): BroadcastListEntry => ({
        ...base(b, input.streams),
        isLive: true,
        willAir: true,
        reason: "On air now — this is what viewers are watching.",
      }),
    ),
    ...input.upcoming.map((b): BroadcastListEntry => {
      const row = base(b, input.streams);
      const qualifies =
        !onAir &&
        encoderStreamId !== null &&
        row.boundStreamId === encoderStreamId &&
        row.autoStart;
      return {
        ...row,
        isLive: false,
        willAir: qualifies,
        reason: !qualifies
          ? whyNot(row, encoderStreamId, onAir)
          : contested
            ? `Competing for “${row.boundStreamTitle}” with ${contenders.length - 1} other auto-start broadcast${contenders.length === 2 ? "" : "s"} — only one of them airs.`
            : `Bound to “${row.boundStreamTitle}” — the key the encoder pushes to — with auto-start on, so YouTube starts it when the encoder does.`,
      };
    }),
  ];

  // Live first, then the one that will air, then soonest — the order the operator's eye should
  // travel. A row with no scheduled start sorts last: it is the least identifiable, not the most
  // imminent.
  entries.sort(
    (a, b) =>
      Number(b.isLive) - Number(a.isLive) ||
      Number(b.willAir) - Number(a.willAir) ||
      startKey(a).localeCompare(startKey(b)),
  );

  const winners = entries.filter((e) => e.willAir);
  return {
    entries,
    encoderStreamId,
    encoderStreamTitle: encoderStreamId
      ? encoderName(input.streams, encoderStreamId)
      : null,
    encoderSource,
    contested,
    verdict: verdictFor(
      winners,
      contested,
      encoderName(input.streams, encoderStreamId),
      encoderSource,
      input.streams.length,
    ),
  };
}

/** The name to call the encoder's key by in copy, falling back to its raw id. */
function encoderName(streams: StreamInfo[], id: string | null): string {
  if (!id) return "the encoder's key";
  return streams.find((s) => s.id === id)?.title ?? id;
}

/** The disqualifying fact, most decisive first — an operator fixes one thing at a time. */
function whyNot(
  row: Omit<BroadcastListEntry, "isLive" | "willAir" | "reason">,
  encoderStreamId: string | null,
  onAir: boolean,
): string {
  // A broadcast already on air is the answer; a waiting one cannot take the encoder from it.
  if (onAir) return "Waiting — the encoder is already feeding the broadcast on air.";
  if (!row.boundStreamId)
    return "Not attached to any ingestion key, so no encoder can feed it.";
  // With no encoder key known, "not the right key" would be an accusation the app cannot
  // support. Say what is actually true — it is attached to *a* key, and nobody said which one
  // matters — so the operator fixes the setting rather than the broadcast.
  if (encoderStreamId === null)
    return `Attached to “${row.boundStreamTitle}”${row.autoStart ? " with auto-start on" : ", and auto-start is off"}. Whether that is the key the encoder pushes to is not something the app has been told.`;
  if (row.boundStreamId !== encoderStreamId)
    return `Attached to “${row.boundStreamTitle}”, not the key the encoder pushes to.`;
  return "Attached to the encoder's key, but auto-start is off — it waits for someone to press Go live.";
}

/** The list's headline answer, stated rather than left to be inferred from a highlight. */
function verdictFor(
  winners: BroadcastListEntry[],
  contested: boolean,
  encoderLabel: string,
  encoderSource: WillAirResult["encoderSource"],
  streamCount: number,
): string {
  // Already airing settles it, whatever the app does or does not know about ingestion keys.
  if (winners.some((w) => w.isLive))
    return airing(winners.find((w) => w.isLive)!);
  if (encoderSource === "unknown")
    return `This channel has ${streamCount} ingestion keys and none is set as the default, so the app cannot say which broadcast will air. Set the default stream in Settings to the key OBS pushes to.`;
  if (contested)
    return `${winners.length} broadcasts are attached to “${encoderLabel}” with auto-start on. The encoder can only feed one, and YouTube — not this app — decides which. Delete the ones you are not using.`;
  if (winners.length === 0)
    return `Nothing will air on its own. No upcoming broadcast is both attached to “${encoderLabel}” and set to auto-start, so starting the encoder makes YouTube create a broadcast of its own.`;
  return airing(winners[0]);
}

function airing(winner: BroadcastListEntry): string {
  return `“${winner.title}” will air. ${winner.reason}`;
}

/** Sort key for "closest to air": no scheduled start sorts after every real timestamp. */
function startKey(e: BroadcastListEntry): string {
  return e.scheduledStartTime ?? "\uffff";
}

/** The fields every row carries, read straight off the broadcast resource. */
function base(
  b: youtube_v3.Schema$LiveBroadcast,
  streams: StreamInfo[],
): Omit<BroadcastListEntry, "isLive" | "willAir" | "reason"> {
  const boundStreamId = b.contentDetails?.boundStreamId ?? null;
  return {
    id: b.id!,
    title: b.snippet?.title ?? b.id!,
    scheduledStartTime: b.snippet?.scheduledStartTime ?? null,
    privacyStatus: b.status?.privacyStatus ?? null,
    lifeCycleStatus: b.status?.lifeCycleStatus ?? null,
    boundStreamId,
    boundStreamTitle:
      streams.find((s) => s.id === boundStreamId)?.title ?? boundStreamId,
    autoStart: b.contentDetails?.enableAutoStart === true,
  };
}
