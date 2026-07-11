import { useEffect, useState } from "react";
import { api, type SetupStatus } from "../api.js";
import { describeConnection } from "../lib/connection.js";

interface Props {
  /** Re-fetch live state so health re-evaluates; a successful reconnect clears the banner. */
  onReconnected: () => Promise<void> | void;
  /** Open the Settings panel — the reconnect path on hosts that can't run the in-app flow. */
  onOpenSettings: () => void;
  flash: (message: string, kind?: "ok" | "err") => void;
}

/**
 * Reauth affordance (PRD-03 §4, issue 015). Rendered only when `health === "auth_error"`: the
 * saved YouTube sign-in has stopped working and no retry will fix it. On an Electron host whose
 * credentials came through the in-app flow, Reconnect re-runs the OAuth consent inline; elsewhere
 * (Docker/headless, env/CLI) it routes to Settings, where the connection guidance lives. On a
 * successful reconnect we refresh state so health drops back to healthy and this banner unmounts.
 *
 * Never shown for `degraded` or `offline` — those are transient and self-heal on the next poll.
 */
export function ReauthBanner({ onReconnected, onOpenSettings, flash }: Props) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.setup.status().then(setStatus).catch(() => {});
  }, []);

  // Until the status lands, assume the in-app flow is unavailable so we never dead-end a click.
  const inApp = status ? describeConnection(status).editable : false;

  const reconnect = async () => {
    if (!inApp) {
      onOpenSettings();
      return;
    }
    setBusy(true);
    try {
      await api.setup.connect();
      await onReconnected();
      flash("YouTube reconnected");
    } catch (e) {
      flash((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="reauth" className="reauth" role="alert">
      <span className="reauth__lamp" aria-hidden="true" />
      <div className="reauth__meta">
        <span className="eyebrow">Connection</span>
        <span className="reauth__title">YouTube connection lost</span>
        <span className="reauth__note">
          The saved sign-in stopped working. Reconnect to resume actions and status.
        </span>
      </div>
      <button
        className="btn btn--danger btn--sm reauth__action"
        type="button"
        onClick={reconnect}
        disabled={busy}
      >
        {busy ? "Waiting for your browser…" : inApp ? "Reconnect" : "Reconnect in settings"}
      </button>
    </div>
  );
}
