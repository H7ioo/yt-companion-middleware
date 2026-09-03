import { SettingsPanel } from "../components/SettingsPanel.js";
import { useDashboard } from "./context.js";

/**
 * Everything set once and then left alone (navbar + pages).
 *
 * The connection, people and app defaults used to be a modal over the dashboard, which made them
 * feel like an interruption to the show rather than the wiring behind it — and buried the two
 * notification panels somewhere else entirely. As a page they sit together, and the browser's
 * back button works, which a modal never gave anyone.
 */
export function SettingsPage() {
  const {
    settings,
    categories,
    streams,
    admin,
    saveSettings,
    flash,
    webhookUrl,
    setWebhookUrl,
    saveWebhook,
    notify,
    setNotify,
    saveNotify,
  } = useDashboard();

  return (
    <>
      {/* Connection, people, devices, audit and app defaults. */}
      <SettingsPanel
        settings={settings}
        categories={categories}
        streams={streams}
        canAdminister={admin}
        onSaveSettings={saveSettings}
        flash={flash}
      />

      {/* Webhook */}
      <section className="panel">
        <div className="panel__head">
          <h2>State webhook</h2>
        </div>
        <div className="panel__body">
          <p className="empty" style={{ marginTop: 0 }}>
            Optional. When set, every meaningful state change (live/idle, privacy, health, busy)
            is POSTed here as{" "}
            <span className="mono">{`{ "event": "state", "state": {…} }`}</span> — so Companion
            reacts instantly instead of polling.
          </p>
          <div className="field">
            <label htmlFor="webhook-url">Webhook URL</label>
            <input
              id="webhook-url"
              type="url"
              value={webhookUrl}
              placeholder="https://…"
              onChange={(e) => setWebhookUrl(e.target.value)}
              onBlur={(e) => saveWebhook(e.target.value)}
            />
          </div>
          <p className="empty">Saves when you leave the field. Clear it to disable.</p>
        </div>
      </section>

      {/* Phone push — the ntfy leg of the Companion fill flow (issue 003 trigger). */}
      <section className="panel">
        <div className="panel__head">
          <h2>Phone push (ntfy)</h2>
        </div>
        <div className="panel__body">
          <p className="empty" style={{ marginTop: 0 }}>
            Optional. A Companion “Request fill” key pops the fill dialog in any open dashboard.
            With a topic set here it also sends an{" "}
            <a href="https://ntfy.sh" target="_blank" rel="noreferrer">
              ntfy
            </a>{" "}
            notification — tap it on your phone to open the fill page, even with no dashboard
            open. Subscribe to the same topic in the ntfy app; treat the topic name as a secret.
          </p>
          <div className="field">
            <label htmlFor="ntfy-topic">Topic</label>
            <input
              id="ntfy-topic"
              value={notify.ntfyTopic}
              placeholder="e.g. masjid-fill-8k2j — empty disables the push"
              onChange={(e) => setNotify({ ...notify, ntfyTopic: e.target.value })}
              onBlur={() => saveNotify(notify)}
            />
          </div>
          <div className="field">
            <label htmlFor="ntfy-server">ntfy server</label>
            <input
              id="ntfy-server"
              type="url"
              value={notify.ntfyServer}
              placeholder="https://ntfy.sh"
              onChange={(e) => setNotify({ ...notify, ntfyServer: e.target.value })}
              onBlur={() => saveNotify(notify)}
            />
          </div>
          <div className="field">
            <label htmlFor="ntfy-base">Public base URL (what the phone opens)</label>
            <input
              id="ntfy-base"
              type="url"
              value={notify.publicBaseUrl}
              placeholder="usually leave blank — this machine's LAN address is used"
              onChange={(e) => setNotify({ ...notify, publicBaseUrl: e.target.value })}
              onBlur={() => saveNotify(notify)}
            />
          </div>
          <p className="empty">
            Leave the base URL blank when the phone is on the same network — the link points at
            this machine's LAN address automatically. Set it only when that address won't reach
            the phone (Tailscale, another subnet, a reverse proxy). Saves when you leave a field.
          </p>
        </div>
      </section>
    </>
  );
}
