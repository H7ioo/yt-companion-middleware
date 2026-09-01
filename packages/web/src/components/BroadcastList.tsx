import { useEffect, useState } from "react";
import { api, type BroadcastListEntry, type BroadcastListing } from "../api.js";

interface Props {
  /**
   * The YouTube API master switch. Reading the list is three live calls, and the switch's whole
   * promise is that a paused install spends no quota — so while it is off, nothing is asked for.
   */
  apiEnabled: boolean;
}

/**
 * Answers the question that otherwise means opening Studio mid-show: **which broadcast will
 * actually air?** (PRD-16 §1, issue 057.)
 *
 * The verdict leads, in a full sentence. Every other panel in this rack leads with controls, and
 * that is right for them — this one exists to state an answer, and an answer conveyed only by
 * "one row looks bolder" is exactly the kind of thing an operator goes to Studio to double-check.
 * The rows underneath are the evidence for it: the key each broadcast is attached to, whether
 * auto-start is on, and — for the ones that are out — the single fact that puts them out.
 *
 * Read on demand, never polled: a list refreshed on an interval costs more quota than the single
 * target the background loop already tracks, so the cost is stated and the operator asks.
 */
export function BroadcastList({ apiEnabled }: Props) {
  const [listing, setListing] = useState<BroadcastListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setListing(await api.broadcasts.list());
    } catch (err) {
      // Left as-is, not emptied: an empty list means "this channel has no broadcasts", which
      // reads as a real answer. A failed read is not evidence of anything.
      setError(
        err instanceof Error ? err.message : "Could not read the broadcast list.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!apiEnabled) return;
    void load();
  }, [apiEnabled]);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>What will air</h2>
        <div className="panel__head-actions">
          {listing ? (
            <span className="rundown__cost mono" title="What this read cost against today's YouTube budget">
              {listing.quotaUnits} quota units
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void load()}
            disabled={loading || !apiEnabled}
            title={apiEnabled ? undefined : "YouTube API is paused"}
          >
            {loading ? "Reading…" : "Refresh list"}
          </button>
        </div>
      </div>
      <div className="panel__body">
        {!apiEnabled ? (
          <p className="patch__lede">
            The YouTube API is paused, so the broadcast list is not being read. Resume it to
            see which broadcast will air.
          </p>
        ) : (
          <>
            {error ? <p className="patch__error">{error}</p> : null}

            {listing ? (
              <p className={`rundown__verdict rundown__verdict--${verdictTone(listing)}`}>
                {listing.verdict}
              </p>
            ) : error ? null : (
              <p className="patch__empty">Reading the channel…</p>
            )}

            {listing && listing.encoderSource === "only-key" ? (
              <p className="patch__lede">
                Read against “{listing.encoderStreamTitle}”, the channel's only ingestion key.
              </p>
            ) : null}

            {listing ? (
              listing.entries.length === 0 ? (
                <p className="patch__empty">
                  No upcoming or live broadcasts on the channel. Schedule one in YouTube Studio,
                  or go live.
                </p>
              ) : (
                <ul className="rundown">
                  {listing.entries.map((e) => (
                    <Row key={e.id} entry={e} contested={listing.contested} />
                  ))}
                </ul>
              )
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function Row({ entry, contested }: { entry: BroadcastListEntry; contested: boolean }) {
  const marked = entry.willAir;
  return (
    <li
      className={`rundown__row${marked ? ` rundown__row--${contested && !entry.isLive ? "contested" : "airs"}` : ""}`}
      aria-label={entry.title}
    >
      <span
        className={`lamp ${entry.isLive ? "lamp--live" : marked ? (contested ? "lamp--warn" : "lamp--ready") : "lamp--idle"}`}
        aria-hidden="true"
      />
      <span className="rundown__meta">
        <span className="rundown__head">
          <span className="rundown__title">{entry.title}</span>
          {entry.isLive ? (
            <span className="rundown__flag rundown__flag--live">On air</span>
          ) : marked ? (
            <span className={`rundown__flag rundown__flag--${contested ? "contested" : "airs"}`}>
              {contested ? "Competing" : "Will air"}
            </span>
          ) : null}
        </span>
        <span className="rundown__facts">
          <span>{when(entry.scheduledStartTime)}</span>
          <span>{entry.boundStreamTitle ?? "No ingestion key"}</span>
          <span>{entry.autoStart ? "Auto-start on" : "Auto-start off"}</span>
          <span>{PRIVACY[entry.privacyStatus ?? ""] ?? "Privacy unknown"}</span>
        </span>
        {entry.reason ? <span className="rundown__reason">{entry.reason}</span> : null}
      </span>
      <span className="patch__id mono">{entry.id}</span>
    </li>
  );
}

/** Which lamp colour the verdict itself carries — the answer's shape, not its severity. */
function verdictTone(listing: BroadcastListing): "airs" | "warn" {
  // Already airing settles it, whatever the app does or does not know about ingestion keys —
  // the same order the server states the verdict in.
  if (listing.entries.some((e) => e.isLive)) return "airs";
  if (listing.contested || listing.encoderSource === "unknown") return "warn";
  return listing.entries.some((e) => e.willAir) ? "airs" : "warn";
}

/** YouTube's privacy values, said the way an operator would say them. */
const PRIVACY: Record<string, string> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
};

function when(iso: string | null): string {
  if (!iso) return "No start time";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "No start time";
  const mins = Math.round((at.getTime() - Date.now()) / 60000);
  const stamp = at.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (mins >= -1 && mins <= 1) return `Starts about now · ${stamp}`;
  const rel =
    Math.abs(mins) < 90 ? `${Math.abs(mins)} min` : `${Math.round(Math.abs(mins) / 60)} h`;
  return mins > 0 ? `In ${rel} · ${stamp}` : `Due ${rel} ago · ${stamp}`;
}
