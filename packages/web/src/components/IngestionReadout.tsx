import { useState } from "react";
import { INGESTION_GLOSSARY } from "@app/shared";
import { api, type IngestionReadout as Readout, type IngestionReport } from "../api.js";
import { LAMP_FOR_KEY_COLOR } from "../lib/lamps.js";

interface Props {
  /**
   * The YouTube API master switch, or null while dashboard state has not loaded. Checking costs a
   * quota unit, and the switch's promise is that a paused install spends none — so `null` is the
   * same "do not ask" as `false`.
   */
  apiEnabled: boolean | null;
  /**
   * The last reading, straight from dashboard state. The poll loop keeps it fresh while a
   * broadcast is live or a latch is armed, so during a show this panel is already current before
   * anyone presses anything — which is the point of putting it here rather than behind a button.
   */
  ingestion: Readout | null;
}

/**
 * **Is video actually arriving at YouTube?** (PRD-16 §3, issue 059.)
 *
 * This is the readout that replaces the most common mid-show Studio trip — "is it stuck on
 * preparing?" — and it answers it with YouTube's own view of the ingestion key, not with an
 * inference from the broadcast's lifecycle.
 *
 * Two things it is careful not to be mistaken for. It is **not health**: health says whether this
 * app can reach YouTube, and a perfectly healthy app watches a key nothing is arriving on. And it
 * is **not the embedded player** (issue 065), which is the audience's delayed view — concluding
 * the encoder is fine because a twenty-second-old frame is still playing is exactly the mistake
 * this panel exists to prevent. Hence the timestamp: an old answer is shown as old, never as now.
 */
export function IngestionReadout({ apiEnabled, ingestion }: Props) {
  const paused = apiEnabled === false;
  const [fresh, setFresh] = useState<Readout | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // Two sources for one fact, so the newer reading wins rather than whichever arrived last. The
  // server caches every on-demand read, so the pushed state catches up within a beat and the two
  // converge; until it does, a check made ten seconds ago must not be replaced by a push carrying
  // the minute-old reading it has not yet superseded.
  const current = newerOf(fresh, ingestion);

  async function check() {
    setChecking(true);
    setError(null);
    try {
      const report: IngestionReport = await api.ingestion.read();
      setFresh(report.readout);
      setNote(report.unavailable);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the ingestion status.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Signal in</h2>
        <div className="panel__head-actions">
          <button
            type="button"
            className="btn btn--sm"
            onClick={check}
            disabled={checking || paused || apiEnabled === null}
            title="Asks YouTube what it is seeing on the default ingestion key — 1 quota unit."
          >
            {checking ? "Checking…" : "Check now"}
          </button>
        </div>
      </div>
      <div className="panel__body">
        {paused ? (
          <p className="empty">
            The YouTube API is switched off, so nothing is being read. Turn it back on in the rail
            to check the signal.
          </p>
        ) : error ? (
          <p className="empty">{error}</p>
        ) : note && !current ? (
          <p className="empty">{note}</p>
        ) : current ? (
          <Reading readout={current} />
        ) : (
          <p className="empty">
            Nothing read yet. This fills itself in while a broadcast is live or a title is waiting
            to land — check now for an answer before then.
          </p>
        )}
        {/* Stated, not buried in a tooltip: every other read on this page announces its cost, and
            an operator watching the quota bar should never have to guess what moved it. */}
        <p className="feed__cost">
          Checking costs 1 quota unit. While a broadcast is live or a title is waiting to land, the
          app re-reads this once a minute on its own; idle, it spends nothing.
        </p>
      </div>
    </section>
  );
}

/** Whichever of two readings was taken later. Either may be absent. */
function newerOf(a: Readout | null, b: Readout | null): Readout | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a.checkedAt) >= Date.parse(b.checkedAt) ? a : b;
}

/** The reading itself: one lamp, one sentence, and the evidence under it. */
function Reading({ readout }: { readout: Readout }) {
  const lamp = LAMP_FOR_KEY_COLOR[INGESTION_GLOSSARY[readout.state].keyColor] ?? "lamp--offline";
  return (
    <div className="feed">
      <span className={`lamp feed__lamp ${lamp}`} aria-hidden="true" />
      <div className="feed__meta">
        <p className="feed__state">{readout.label}</p>
        <p className="feed__note">{readout.meaning}</p>
        {/* The remedy only earns its line when there is something to do about it. */}
        {readout.state !== "receiving" && <p className="feed__note">{readout.remedy}</p>}
        {readout.issues.length > 0 && (
          <ul className="feed__issues">
            {readout.issues.map((issue, i) => (
              <li key={`${issue.reason ?? "issue"}-${i}`}>
                {issue.description ?? issue.reason ?? "YouTube reported a problem with the feed."}
              </li>
            ))}
          </ul>
        )}
        <p className="feed__stamp">
          <span className="mono">{readout.streamTitle ?? readout.streamId}</span> · read{" "}
          {sinceLabel(readout.checkedAt)}
        </p>
      </div>
    </div>
  );
}

/**
 * How long ago the reading was taken, in words. The whole readout turns on this: "receiving video"
 * from twenty minutes ago is a fact about twenty minutes ago, and printing it without the stamp is
 * how an operator concludes the encoder is fine while OBS sits disconnected.
 */
export function sinceLabel(checkedAt: string, now: number = Date.now()): string {
  const ms = now - Date.parse(checkedAt);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}
