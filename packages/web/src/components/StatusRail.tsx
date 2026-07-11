import type { DashboardState, QuotaSnapshot } from "../api.js";

const HEALTH_LABEL: Record<string, string> = {
  ok: "Healthy",
  degraded: "Degraded",
  auth_error: "Auth error",
};

function QuotaReadout({ quota }: { quota: QuotaSnapshot | undefined }) {
  if (!quota) return null;
  const pct =
    quota.limit > 0 ? Math.min(100, (quota.used / quota.limit) * 100) : 0;
  // Yellow past 75%, red past 90% — a mid-stream warning before the 403 hits.
  const level = pct >= 90 ? "err" : pct >= 75 ? "warn" : "ok";
  return (
    <div className="readout">
      <span className="readout__label">API quota</span>
      <span className="readout__value">
        <span className={`quota-bar quota-bar--${level}`}>
          <span className="quota-bar__fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="mono">
          {quota.used.toLocaleString()} / {quota.limit.toLocaleString()}
        </span>
      </span>
    </div>
  );
}

export function StatusRail({
  state,
  onRefresh,
  refreshing,
  onToggleApi,
  onOpenSettings,
}: {
  state: DashboardState | null;
  onRefresh: () => void;
  refreshing: boolean;
  onToggleApi: (next: boolean) => void;
  onOpenSettings: () => void;
}) {
  const isLive = state?.status.isLive ?? false;
  const noTarget = state?.status.noTarget ?? false;
  const health = state?.health ?? "ok";
  const busy = state?.busy ?? false;
  // Default to armed until the first state lands, so the breaker doesn't flash "paused" on load.
  const apiEnabled = state?.apiEnabled ?? true;

  return (
    <aside className="rail">
      <div className="rail__brand">
        <span className="eyebrow">Companion &rarr; YouTube Live</span>
        <h1>Broadcast Control</h1>
        <a className="rail__manual" href="/guide" target="_blank" rel="noreferrer">
          Operator manual &amp; Companion setup &rarr;
        </a>
        <button className="rail__settings" type="button" onClick={onOpenSettings}>
          <span aria-hidden="true">⚙</span> Settings
        </button>
      </div>

      {/* Main breaker — cuts every YouTube call so an idle rig spends zero quota. */}
      <div className={`breaker ${apiEnabled ? "breaker--on" : "breaker--off"}`}>
        <div className="breaker__meta">
          <span className="eyebrow">YouTube API</span>
          <span className="breaker__state">{apiEnabled ? "Live" : "Paused"}</span>
          <span className="breaker__note">
            {apiEnabled
              ? "Actions and background polling active"
              : "No calls sent — quota untouched"}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={apiEnabled}
          aria-label={apiEnabled ? "Pause YouTube API" : "Enable YouTube API"}
          className="breaker__switch"
          disabled={state == null}
          onClick={() => onToggleApi(!apiEnabled)}
        >
          <span className="breaker__track">
            <span className="breaker__knob" />
          </span>
        </button>
      </div>

      <div className="tally">
        <div className="tally__lamp">
          <span className={`lamp ${isLive ? "lamp--live" : "lamp--ready"}`} />
          <span className="eyebrow">{isLive ? "On air" : "Standby"}</span>
        </div>
        <div className="tally__state">{isLive ? "LIVE" : "IDLE"}</div>
        <div className="tally__title">
          {noTarget
            ? "No broadcast — create or go live on YouTube"
            : (state?.status.title ?? "No metadata cached yet")}
        </div>
      </div>

      <div className="readouts">
        <div className="readout">
          <span className="readout__label">Target</span>
          <span className="readout__value">
            {noTarget
              ? "None"
              : isLive
                ? "Active broadcast"
                : "Persistent container"}
          </span>
        </div>
        <div className="readout">
          <span className="readout__label">Privacy</span>
          <span className="readout__value mono">
            {state?.status.privacyStatus ?? "—"}
          </span>
        </div>
        <div className="readout">
          <span className="readout__label">Health</span>
          <span className="readout__value">
            <span
              className={`lamp ${
                health === "ok"
                  ? "lamp--ready"
                  : health === "degraded"
                    ? "lamp--warn"
                    : "lamp--err"
              }`}
            />
            {HEALTH_LABEL[health]}
          </span>
        </div>
        <div className="readout">
          <span className="readout__label">Pipeline</span>
          <span className="readout__value">
            <span className={`lamp ${busy ? "lamp--warn" : ""}`} />
            {busy ? "Processing" : "Ready"}
          </span>
        </div>
        <QuotaReadout quota={state?.quota} />
      </div>

      <div className="rail__foot">
        <button
          className="btn btn--sm"
          onClick={onRefresh}
          disabled={refreshing || !apiEnabled}
          title={
            apiEnabled
              ? "Re-fetch the current title, status and privacy live from YouTube"
              : "Enable the YouTube API to refresh"
          }
        >
          {refreshing ? "Refreshing…" : "Refresh from YouTube"}
        </button>
        <div style={{ marginTop: 8 }}>
          {state?.lastRefreshedAt
            ? `Cache updated ${new Date(state.lastRefreshedAt).toLocaleTimeString()}`
            : "Awaiting first refresh…"}
        </div>
        {state?.healthMessage ? (
          <div style={{ marginTop: 6 }}>{state.healthMessage}</div>
        ) : null}
        <a className="rail__docs" href="/docs" target="_blank" rel="noreferrer">
          API console <span aria-hidden="true">&rarr;</span>
        </a>
      </div>
    </aside>
  );
}
