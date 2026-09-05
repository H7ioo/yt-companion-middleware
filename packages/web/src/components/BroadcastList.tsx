import { useEffect, useState } from "react";
import { api, type BroadcastListEntry, type BroadcastListing, type TargetPin } from "../api.js";
import { watchUrl } from "../lib/watch.js";

interface Props {
  /**
   * The YouTube API master switch, or null while the dashboard state has not loaded yet.
   *
   * Reading the list is three live calls, and the switch's whole promise is that a paused install
   * spends no quota — so while it is off, nothing is asked for. `null` is the same "do not ask"
   * as `false`: defaulting an unknown switch to "on" spent that quota on every page load of a
   * paused install, before the state that would have said so arrived.
   */
  apiEnabled: boolean | null;
  /**
   * The pinned edit target, straight from dashboard state — the same value the Edit target panel
   * renders (issue 058). Held as a prop rather than as this panel's own copy on purpose: the pin
   * is one concept surfaced twice, and a local copy is how two surfaces start disagreeing.
   */
  pin: TargetPin | null;
  /** Refetches dashboard state, so the rail and the pin follow a pin set from here. */
  onPinned: () => void;
  /**
   * Whether this surface may act on a broadcast, rather than only read and pin it (issue 069).
   *
   * The Live page and the Broadcasts page render the same list from the same fetch — the verdict,
   * the evidence and the disagreement warning are one piece of code, not two — and this is the
   * whole of the difference between them. Live is read at 22:58 with the show about to start, and
   * a Delete sitting a few pixels from the row being watched is not something to hand an operator
   * mid-count. Management lives on the page opened deliberately, in the afternoon.
   */
  manage?: boolean;
}

/**
 * The last listing read, held outside the component (issue 069).
 *
 * Live and Broadcasts render this same panel from two routes, so mounting is exactly what happens
 * when the operator moves between them — and a fetch on every mount would charge three quota units
 * per navigation, against a panel whose whole contract is "read on demand, never polled". The read
 * belongs to the session, not to the mount; "Refresh list" is how it is asked for again.
 */
let cached: BroadcastListing | null = null;

/** Drops the session's cached listing. For tests, and for a sign-out that changes whose channel this is. */
export function resetBroadcastCache() {
  cached = null;
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
 *
 * Selecting a row sets the **edit-target pin** (issue 058) — the same state the Edit target panel
 * writes, not a second one. The list is the better place to choose from, because it carries the
 * evidence the choice turns on; the pin stays the one answer to "which broadcast do my actions
 * apply to", and this panel says so out loud when the operator's choice and the airing marker
 * point at different broadcasts.
 */
export function BroadcastList({ apiEnabled, pin, onPinned, manage = false }: Props) {
  // Read once, at the top: `false` and `null` differ in what the panel says, but not in whether
  // it may spend quota.
  const paused = apiEnabled === false;
  const known = apiEnabled !== null;
  const [listing, setListing] = useState<BroadcastListing | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // The link last copied, so exactly one row says "Copied" — two rows claiming it is a lie about
  // what is actually on the clipboard.
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      cached = await api.broadcasts.list();
      setListing(cached);
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

  /**
   * Selecting a row **sets the pin** — it does not open a second notion of "the chosen
   * broadcast" (issue 058, PRD-16 §8). The listing is deliberately not re-read afterwards: the
   * channel has not changed, only where this app writes, and a re-read would spend the panel's
   * three quota units on every pick.
   */
  async function choose(entry: BroadcastListEntry | null) {
    setSaving(true);
    setError(null);
    try {
      await api.target.pin(entry?.id ?? null, entry?.title ?? null);
      onPinned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the target.");
    } finally {
      setSaving(false);
    }
  }

  /** Puts the audience's link on the clipboard, or says plainly that it did not. */
  function copy(url: string) {
    // Read the API out before using it: this app is normally reached over plain HTTP on the LAN,
    // and there `navigator.clipboard` is not merely a failing promise but absent entirely. An
    // optional call on it short-circuits the whole chain, so the button would do nothing at all
    // and the sentence below — the one thing that tells the operator to copy by hand — would
    // never be shown.
    const clipboard = navigator.clipboard;
    const failed = () =>
      setError("Could not reach the clipboard — select the link and copy the link by hand.");
    if (!clipboard) {
      failed();
      return;
    }
    void clipboard.writeText(url).then(() => setCopiedUrl(url), failed);
  }

  useEffect(() => {
    if (apiEnabled !== true) return;
    // Already read this session: the listing outlives the component on purpose (see `cached`).
    if (listing) return;
    void load();
  }, [apiEnabled, listing]);

  return (
    <section className="panel">
      <div className="panel__head">
        {/* Two questions, two names. Live asks which broadcast wins tonight; this page holds
            the channel's collection and is where one is acted on. */}
        <h2>{manage ? "Broadcasts" : "What will air"}</h2>
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
            disabled={loading || apiEnabled !== true}
            title={paused ? "YouTube API is paused" : undefined}
          >
            {loading ? "Reading…" : "Refresh list"}
          </button>
        </div>
      </div>
      <div className="panel__body">
        {paused ? (
          <p className="patch__lede">
            The YouTube API is paused, so the broadcast list is not being read. Resume it to
            see {manage ? "the channel's broadcasts" : "which broadcast will air"}.
          </p>
        ) : !known ? (
          <p className="patch__empty">Waiting for the connection…</p>
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

            {listing ? <Disagreement listing={listing} pin={pin} /> : null}

            {listing && listing.encoderSource === "only-key" ? (
              <p className="patch__lede">
                Read against “{listing.encoderStreamTitle}”, the channel's only ingestion key.
              </p>
            ) : null}

            {listing ? (
              <div role="radiogroup" aria-label="Broadcast to target">
                <ul className="rundown">
                  {/* Letting the app choose is a row in the same group, not a button off to the
                      side: it is one of the answers to "which broadcast do actions write to", and
                      as an outside control it left the group with nothing checked whenever no pin
                      was set — the state most installs sit in. Listed even when the channel has
                      no broadcasts, because a pin on a deleted one still needs a way back. */}
                  <AutomaticRow
                    selected={pin === null}
                    disabled={saving}
                    onSelect={() => void choose(null)}
                  />
                  {listing.entries.map((e) => (
                    <Row
                      key={e.id}
                      entry={e}
                      contested={listing.contested}
                      pinned={pin?.id === e.id}
                      disabled={saving}
                      onSelect={() => void choose(e)}
                      manage={manage}
                      copied={copiedUrl === watchUrl(e.id)}
                      onCopy={() => copy(watchUrl(e.id))}
                    />
                  ))}
                </ul>
              </div>
            ) : null}

            {listing && listing.entries.length === 0 ? (
              <p className="patch__empty">
                No upcoming or live broadcasts on the channel.{" "}
                {manage ? "Prepare one on the Schedule page, or go live." : "Schedule one in YouTube Studio, or go live."}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

/** The "let the app decide" answer, sitting in the same group as the broadcasts it competes with. */
function AutomaticRow({
  selected,
  disabled,
  onSelect,
}: {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <li className={`rundown__row${selected ? " rundown__row--pinned" : ""}`}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        className="rundown__pick"
        disabled={disabled}
        onClick={onSelect}
        title="Let the app rank the waiting broadcasts and edit the one closest to going live"
      >
        <span className="lamp lamp--idle" aria-hidden="true" />
        <span className="rundown__meta">
          <span className="rundown__head">
            <span className="rundown__title">Choose automatically</span>
            {selected ? (
              <span className="rundown__flag rundown__flag--pinned">Target</span>
            ) : null}
          </span>
          <span className="rundown__facts">
            <span>Edits whichever broadcast is closest to going live.</span>
          </span>
        </span>
      </button>
    </li>
  );
}

interface RowProps {
  entry: BroadcastListEntry;
  contested: boolean;
  /** True when this is the broadcast actions write to — the pin, not the airing marker. */
  pinned: boolean;
  disabled: boolean;
  onSelect: () => void;
  /** Whether this row carries the actions, or only the evidence (issue 069). */
  manage: boolean;
  copied: boolean;
  onCopy: () => void;
}

function Row({
  entry,
  contested,
  pinned,
  disabled,
  onSelect,
  manage,
  copied,
  onCopy,
}: RowProps) {
  const marked = entry.willAir;
  return (
    <li
      className={`rundown__row${marked ? ` rundown__row--${contested && !entry.isLive ? "contested" : "airs"}` : ""}${pinned ? " rundown__row--pinned" : ""}`}
      aria-label={entry.title}
    >
      <button
        type="button"
        role="radio"
        aria-checked={pinned}
        className="rundown__pick"
        disabled={disabled || entry.isLive}
        onClick={onSelect}
        title={
          entry.isLive
            ? "On air — actions edit the live broadcast whatever is targeted"
            : "Send this app's actions to this broadcast"
        }
      >
        <span
          className={`lamp ${entry.isLive ? "lamp--live" : marked ? (contested ? "lamp--warn" : "lamp--ready") : "lamp--idle"}`}
          aria-hidden="true"
        />
        <span className="rundown__meta">
          <span className="rundown__head">
            <span className="rundown__title">{entry.title}</span>
            {pinned ? (
              <span className="rundown__flag rundown__flag--pinned">Target</span>
            ) : null}
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
      </button>
      {/* The id and the actions share the right edge: the id is what a row is identified by in
          Studio and in the activity log, and the actions are what is done to the thing it
          names. On the read-only list the column is the id alone, exactly as it was. */}
      <span className="rundown__aside">
        <span className="patch__id mono">{entry.id}</span>
        {manage ? (
          <span className="rundown__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onCopy}
              title="Copy the audience's link to this broadcast"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </span>
        ) : null}
      </span>
    </li>
  );
}

/**
 * The one thing a list and a pin can say at the same time that is worse than either alone:
 * **your actions are going somewhere other than what is about to air** (issue 058). Said out
 * loud, because both halves look correct on their own — the marker is right, the pin is right,
 * and only the pair is wrong.
 *
 * Silent when they agree, when nothing is pinned, and when nothing qualifies to air: the verdict
 * above already carries the last case, and repeating it here would train the operator to skip
 * this line on the night it matters.
 */
function Disagreement({
  listing,
  pin,
}: {
  listing: BroadcastListing;
  pin: TargetPin | null;
}) {
  if (!pin) return null;
  const name = pin.label ?? pin.id;
  if (!listing.entries.some((e) => e.id === pin.id)) {
    return (
      <p className="rundown__disagree" role="status">
        Actions target “{name}”, which is no longer on the channel. Pick a row below, or choose
        automatically.
      </p>
    );
  }
  const airing = listing.entries.filter((e) => e.willAir);
  if (airing.length === 0 || airing.some((e) => e.id === pin.id)) return null;
  const others = airing.map((e) => `“${e.title}”`).join(" and ");
  // A live broadcast is not merely "what will air" — it is where the server sends every action,
  // pin or no pin (`resolveTarget` returns the active broadcast before it ever reads the pin).
  // So the warning has to be the opposite one: the edit lands on the broadcast on air, not on
  // the one the operator picked.
  const live = airing.filter((e) => e.isLive);
  if (live.length > 0) {
    const onAir = live.map((e) => `“${e.title}”`).join(" and ");
    return (
      <p className="rundown__disagree" role="status">
        Actions target “{name}”, but {onAir} {live.length > 1 ? "are" : "is"} on air — edits
        go to the live broadcast until it ends, not to “{name}”.
      </p>
    );
  }
  return (
    <p className="rundown__disagree" role="status">
      Actions target “{name}”, but {others} {airing.length > 1 ? "are" : "is"} what will air.
      Editing “{name}” will not change what viewers see.
    </p>
  );
}

/** Which lamp colour the verdict itself carries — the answer's shape, not its severity. */
function verdictTone(listing: BroadcastListing): "airs" | "warn" {
  // Already airing settles it — unless two broadcasts are, which is exactly what `contested`
  // carries for a live channel. Same order the server states the verdict in.
  if (listing.contested) return "warn";
  if (listing.entries.some((e) => e.isLive)) return "airs";
  if (listing.encoderSource === "unknown" || listing.encoderSource === "dangling")
    return "warn";
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
