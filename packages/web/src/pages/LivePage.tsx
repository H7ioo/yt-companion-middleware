import { BroadcastList } from "../components/BroadcastList.js";
import { IngestionReadout } from "../components/IngestionReadout.js";
import { WatchPanel } from "../components/WatchPanel.js";
import { TargetPicker } from "../components/TargetPicker.js";
import { useDashboard } from "./context.js";

/**
 * Tonight, as it is happening (navbar + pages).
 *
 * The order is the order the questions get asked when something looks wrong: what will air, what
 * can be done to it right now, whether video is arriving, what the audience actually sees, and —
 * last, because it is set once and then left — which broadcast the actions write to.
 */
export function LivePage() {
  const {
    state,
    apiEnabled,
    refreshSession,
    undo,
    togglePrivacy,
    openAdHoc,
  } = useDashboard();

  return (
    <>
      {/* What YouTube will actually feed when the encoder starts, and — since issue 058 — the
          second surface for the same edit-target pin the picker below writes. First because
          "which one airs" is the question that comes first (issue 057). */}
      <BroadcastList
        apiEnabled={state ? state.apiEnabled : null}
        pin={state?.targetPin ?? null}
        onPinned={refreshSession}
      />

      {/* The three things done to a broadcast that is already on air. Directly under the list
          because each one acts on the broadcast the list has just named. */}
      <section className="panel">
        <div className="panel__head">
          <h2>On-air actions</h2>
          <div className="panel__head-actions">
            <button
              className="btn btn--sm"
              onClick={undo}
              disabled={(state?.busy ?? false) || !state?.undo || !apiEnabled}
              title={
                state?.undo
                  ? `Revert the last change${state.undo.label ? ` (was “${state.undo.label}”)` : ""}`
                  : "Nothing to undo yet"
              }
            >
              Undo
            </button>
            <button
              className="btn btn--sm"
              onClick={togglePrivacy}
              disabled={
                (state?.busy ?? false) || (state?.status.noTarget ?? false) || !apiEnabled
              }
              title={
                apiEnabled
                  ? "Flip the live target between private and public"
                  : "YouTube API is paused"
              }
            >
              Toggle privacy
            </button>
            <button
              className="btn btn--sm"
              onClick={openAdHoc}
              disabled={!apiEnabled}
              title={apiEnabled ? undefined : "YouTube API is paused"}
            >
              Ad-hoc update…
            </button>
          </div>
        </div>
        <div className="panel__body">
          <p className="empty" style={{ marginTop: 0 }}>
            These write straight to the broadcast above, without a preset. Undo reverts the last
            change this app made.
          </p>
        </div>
      </section>

      {/* Whether video is actually arriving, right below the list it explains: "nothing will
          air" and "nothing is arriving" are different faults with different fixes, and seeing
          them together is what stops a Studio trip to work out which one this is (issue 059). */}
      <IngestionReadout
        apiEnabled={state ? state.apiEnabled : null}
        ingestion={state?.ingestion ?? null}
      />

      {/* The audience's own view, on request — "is it out, and does it look right" (issue
          065). Directly under Signal in, and never instead of it: the embed is a delayed
          picture, and the panel that answers "is video arriving right now" has to be the one
          read first. */}
      {state ? <WatchPanel status={state.status} /> : null}

      {/* Which broadcast every action writes to, here and on the Presets page (PRD-12). */}
      <TargetPicker
        pin={state?.targetPin ?? null}
        apiEnabled={apiEnabled}
        onChanged={refreshSession}
      />
    </>
  );
}
