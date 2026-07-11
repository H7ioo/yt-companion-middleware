import { useEffect, useState } from "react";
import { api, type Category, type DefaultSettings, type SetupStatus, type StreamInfo } from "../api.js";
import { describeConnection } from "../lib/connection.js";
import { CategorySelect } from "./CategorySelect.js";
import { useEscape } from "../lib/useEscape.js";

interface Props {
  settings: DefaultSettings;
  categories: Category[];
  streams: StreamInfo[];
  onSaveSettings: (next: DefaultSettings) => void;
  flash: (message: string, kind?: "ok" | "err") => void;
  onClose: () => void;
}

type Busy = "idle" | "connecting" | "waiting" | "disconnecting";

/**
 * Settings page (issue 014 / PRD-03 §3): a Connection section (status, active flow,
 * Connect / Reconnect / Disconnect) alongside the app defaults, reachable any time — not just on
 * first run. Reads the connection state as booleans from `/api/setup/status`; secrets never arrive
 * here. On a headless/Docker host, or when credentials come from env/CLI, the connection is
 * read-only and shows guidance instead of buttons.
 */
export function SettingsPanel({ settings, categories, streams, onSaveSettings, flash, onClose }: Props) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState<Busy>("idle");
  const [showOwn, setShowOwn] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  useEscape(busy === "idle" ? onClose : () => {});

  const loadStatus = () => api.setup.status().then(setStatus).catch(() => {});
  useEffect(() => {
    void loadStatus();
  }, []);

  const view = status ? describeConnection(status) : null;
  const working = busy !== "idle";

  // Re-run the loopback consent flow against whichever client is already stored (bundled or the
  // operator's own) — reconnect needs no re-entry of the secret, which never left the server.
  const runConnect = async (override?: { clientId: string; clientSecret: string }) => {
    setBusy("connecting");
    try {
      await api.setup.connect(override);
      setBusy("waiting");
      await settle((s) => s.configured);
      await loadStatus();
      setShowOwn(false);
      setClientId("");
      setClientSecret("");
      flash("YouTube connected");
    } catch (e) {
      flash((e as Error).message, "err");
    } finally {
      setBusy("idle");
    }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect this YouTube channel? The saved sign-in is discarded and the app returns to setup.")) {
      return;
    }
    setBusy("disconnecting");
    try {
      await api.setup.disconnect();
      // The server reboots into setup mode — wait for it to report not-configured, then refresh.
      await settle((s) => !s.configured);
      await loadStatus();
      flash("YouTube disconnected");
    } catch (e) {
      flash((e as Error).message, "err");
    } finally {
      setBusy("idle");
    }
  };

  const streamKnown =
    settings.defaultStreamBoundId == null ||
    streams.length === 0 ||
    streams.some((s) => s.id === settings.defaultStreamBoundId);

  return (
    <div className="overlay" onClick={busy === "idle" ? onClose : undefined}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings__head">
          <span className="eyebrow">Settings</span>
          <h2>Connection &amp; defaults</h2>
          <button className="settings__x" type="button" onClick={onClose} aria-label="Close settings" disabled={working}>
            ✕
          </button>
        </div>

        {/* ---- Connection ---- */}
        <section className="settings__section">
          <h3 className="settings__title">YouTube connection</h3>

          {view == null ? (
            <p className="empty" style={{ marginTop: 0 }}>Checking connection…</p>
          ) : (
            <>
              <div className="conn">
                <span className={`lamp ${view.connected ? "lamp--live" : "lamp--warn"}`} />
                <div className="conn__meta">
                  <span className="conn__state">{view.connected ? "Connected" : "Not connected"}</span>
                  {view.flowLabel ? <span className="conn__flow">via {view.flowLabel}</span> : null}
                </div>
              </div>

              {view.editable ? (
                <div className="settings__actions">
                  {view.connected ? (
                    <>
                      <button className="btn btn--sm" onClick={() => runConnect()} disabled={working}>
                        {busy === "connecting"
                          ? "Waiting for your browser…"
                          : busy === "waiting"
                            ? "Finishing up…"
                            : "Reconnect"}
                      </button>
                      <button className="btn btn--sm btn--danger" onClick={disconnect} disabled={working}>
                        {busy === "disconnecting" ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </>
                  ) : (
                    <button className="btn btn--primary btn--sm" onClick={() => runConnect()} disabled={working}>
                      {busy === "connecting"
                        ? "Waiting for your browser…"
                        : busy === "waiting"
                          ? "Finishing up…"
                          : "Connect YouTube"}
                    </button>
                  )}
                </div>
              ) : (
                <p className="empty conn__guidance">
                  This connection is managed outside the app — set{" "}
                  <span className="mono">YT_CLIENT_ID</span>, <span className="mono">YT_CLIENT_SECRET</span> and{" "}
                  <span className="mono">YT_REFRESH_TOKEN</span> in the environment, or run the token script, then
                  restart. See the{" "}
                  <a className="settings__link" href="/guide" target="_blank" rel="noreferrer">
                    operator guide
                  </a>
                  .
                </p>
              )}

              {view.editable ? (
                <>
                  <button
                    className="settings__disclosure"
                    type="button"
                    onClick={() => setShowOwn((v) => !v)}
                    disabled={working}
                  >
                    {showOwn ? "Hide" : "Use my own Google client instead"}
                  </button>
                  {showOwn ? (
                    <form
                      className="settings__own"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void runConnect({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
                      }}
                    >
                      <div className="field">
                        <label htmlFor="set-client-id">Client ID</label>
                        <input
                          id="set-client-id"
                          className="mono"
                          value={clientId}
                          placeholder="xxxxxxxx.apps.googleusercontent.com"
                          onChange={(e) => setClientId(e.target.value)}
                          disabled={working}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="set-client-secret">Client secret</label>
                        <input
                          id="set-client-secret"
                          className="mono"
                          type="password"
                          value={clientSecret}
                          placeholder="GOCSPX-…"
                          onChange={(e) => setClientSecret(e.target.value)}
                          disabled={working}
                        />
                      </div>
                      {status?.redirectUri ? (
                        <p className="conn__redirect">
                          Add this authorized redirect URI to your client:{" "}
                          <code className="mono">{status.redirectUri}</code>
                        </p>
                      ) : null}
                      <button
                        className="btn btn--primary btn--sm"
                        type="submit"
                        disabled={working || !clientId.trim() || !clientSecret.trim()}
                      >
                        Connect with my client
                      </button>
                    </form>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </section>

        {/* ---- App defaults ---- */}
        <section className="settings__section">
          <h3 className="settings__title">App defaults</h3>
          <p className="empty" style={{ marginTop: 0 }}>
            Baseline used whenever a preset or ad-hoc update leaves category or stream binding blank.
          </p>
          <div className="field--row" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="set-def-cat">Default category</label>
              <CategorySelect
                id="set-def-cat"
                value={settings.defaultCategory}
                categories={categories}
                blankLabel="— none (leave untouched) —"
                onChange={(value) => onSaveSettings({ ...settings, defaultCategory: value })}
              />
            </div>
            <div className="field">
              <label htmlFor="set-def-stream">Default stream binding</label>
              <input
                id="set-def-stream"
                list="set-def-stream-list"
                defaultValue={settings.defaultStreamBoundId ?? ""}
                placeholder="stream id / key"
                aria-invalid={!streamKnown}
                onBlur={(e) =>
                  onSaveSettings({ ...settings, defaultStreamBoundId: e.target.value.trim() || null })
                }
              />
              <datalist id="set-def-stream-list">
                {streams.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                    {s.streamName ? ` · ${s.streamName}` : ""}
                  </option>
                ))}
              </datalist>
              {!streamKnown ? (
                <p className="field-warn">
                  ⚠ No live stream on this channel has that ID — updates that rely on the default binding will fail.
                </p>
              ) : null}
            </div>
          </div>
          <p className="empty">Changes save when you leave a field.</p>
        </section>
      </div>
    </div>
  );
}

/** Polls the setup status until `done` holds (the restarted/rebuilt server settled) or it times out. */
async function settle(done: (s: SetupStatus) => boolean, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  await delay(400);
  while (Date.now() < deadline) {
    try {
      const s = await api.setup.status();
      if (done(s)) return;
    } catch {
      /* server mid-restart — keep polling */
    }
    await delay(500);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
