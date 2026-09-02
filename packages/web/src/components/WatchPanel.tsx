import { useState } from "react";
import type { FeedbackStatus } from "../api.js";
import { describeWatch } from "../lib/watch.js";

interface Props {
  /**
   * The broadcast the app is describing, straight from dashboard state — the same status the
   * rail reads. Held as a prop rather than fetched here: this panel spends no quota of its own,
   * and a second read of "what is on air" is a second answer that can disagree with the first.
   */
  status: FeedbackStatus;
}

/**
 * **Is it out, and does it look right?** (PRD-16 §4, issue 065.)
 *
 * The audience's own view, so the answer does not cost a trip to Studio or a phone held up to
 * the desk. Everything else about the panel follows from what this view is *not*.
 *
 * It is **not the live signal**. The embed runs seconds to a minute behind, so a frame still
 * playing here is evidence about the show a minute ago — "did the audio just cut" is the one
 * question it answers wrongly, and that answer is convincing. Issue 059's readout is the live
 * one, and this panel says so rather than leaving the operator to remember it.
 *
 * It is **not free where it matters most**. The machine most likely to have this dashboard open
 * is the machine running OBS, where a player costs the encoder bandwidth and CPU and plays the
 * show's audio over itself. Hence the press: nothing loads until someone asks for it, and the
 * cost is stated where they would otherwise ask for it without thinking.
 */
export function WatchPanel({ status }: Props) {
  const watch = describeWatch(status);
  const [playing, setPlaying] = useState(false);
  // The broadcast ending — or being swapped for the one that actually airs — takes the player
  // with it. A frame left running past the end goes on showing the last thing it buffered.
  if (watch.kind !== "player" && playing) setPlaying(false);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Audience view</h2>
        {watch.kind === "player" && playing ? (
          <div className="panel__head-actions">
            <a className="btn btn--ghost btn--sm" href={watch.watchUrl} target="_blank" rel="noreferrer">
              Open on YouTube
            </a>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPlaying(false)}>
              Stop playing
            </button>
          </div>
        ) : null}
      </div>
      <div className="panel__body">
        {watch.kind === "waiting" ? (
          <p className="empty">
            Nothing is on air. Once the show starts, the audience's view can be played here.
          </p>
        ) : watch.kind === "studio" ? (
          <>
            <p className="watch__lede">{watch.why}</p>
            <a className="btn" href={watch.studioUrl} target="_blank" rel="noreferrer">
              Open in YouTube Studio
            </a>
          </>
        ) : playing ? (
          <div className="watch__frame">
            <iframe
              src={watch.embedUrl}
              title="The broadcast as viewers see it"
              allow="fullscreen"
              allowFullScreen
            />
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setPlaying(true)}>
            Play the audience's view
          </button>
        )}

        {watch.kind === "waiting" ? null : <Caveats />}
      </div>
    </section>
  );
}

/**
 * The two facts that make this panel actively misleading if they go unsaid — stated before the
 * press, and kept on screen while it plays, because that is when they are believed.
 */
function Caveats() {
  return (
    <ul className="watch__caveats">
      <li>
        <strong>This is the audience's view, seconds to a minute behind.</strong> It answers
        whether the show is out and looks right — not whether the audio just cut. Signal in,
        above, answers that.
      </li>
      <li>
        <strong>Not on the encoder machine.</strong> Playing here costs the machine running OBS
        bandwidth and CPU, and the show's audio plays over itself.
      </li>
    </ul>
  );
}
