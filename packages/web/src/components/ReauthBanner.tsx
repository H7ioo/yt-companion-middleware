import { useEffect, useState } from "react";
import { api, type SetupStatus } from "../api.js";
import { describeConnection } from "../lib/connection.js";

interface Props {
  /** False for a signed-in user: reconnecting the channel is an admin action (issue 045). */
  canAdminister: boolean;
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
 *
 * A user sees the banner too: the outage is theirs as much as anyone's, and the dashboard has
 * stopped working for them. What they are given is the name of who can fix it, in place of a
 * button that would refuse them (issue 045).
 */
export function ReauthBanner({ canAdminister, onReconnected, onOpenSettings, flash }: Props) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (canAdminister) api.setup.status().then(setStatus).catch(() => {});
  }, [canAdminister]);

  // Until the status lands, assume the in-app flow is unavailable so we never dead-end a click.
  // Only `in-app` reconnects here: a headless host's credentials are replaceable too, but by
  // pasting a token into a form, which belongs in Settings and not in a one-button banner.
  const inApp = status ? describeConnection(status).mode === "in-app" : false;

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
          {canAdminister
            ? "The saved sign-in stopped working. Reconnect to resume actions and status."
            : "The saved sign-in stopped working. An admin has to reconnect the channel before actions and status resume."}
        </span>
      </div>
      {canAdminister ? (
        <button
          className="btn btn--danger btn--sm reauth__action"
          type="button"
          onClick={reconnect}
          disabled={busy}
        >
          {busy ? "Waiting for your browser…" : inApp ? "Reconnect" : "Reconnect in settings"}
        </button>
      ) : null}
    </div>
  );
}
