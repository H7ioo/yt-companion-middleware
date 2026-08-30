import { useState } from "react";
import { api, type SessionInfo } from "../api.js";
import { expiryNotice } from "../lib/session.js";

interface Props {
  info: SessionInfo | null;
  /** Re-fetch the session state after renewal, so the notice unmounts once the clock is fresh. */
  onRenewed: () => Promise<void> | void;
}

/**
 * The 90-day cap, announced before it lands (issue 043 / PRD-15 §2).
 *
 * A session cannot be extended by use — only re-authentication issues a new absolute clock — so
 * without this notice a signed-in operator is simply logged out one day, potentially mid-stream.
 * Rendered only inside the last week, and it says which day, not "soon".
 */
export function SessionNotice({ info, onRenewed }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notice = expiryNotice(info);
  if (!notice) return null;

  const renew = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.auth.reauth();
      await onRenewed();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="session-notice" role="status">
      <div className="session-notice__meta">
        <span className="eyebrow">Session</span>
        {/* The deadline is the point of this component: a failed renewal is reported alongside
            it, never in place of it. */}
        <span className="session-notice__text">{notice}</span>
        {error ? (
          <span className="session-notice__error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      <button className="btn btn--sm" type="button" onClick={renew} disabled={busy}>
        {busy ? "Renewing…" : "Stay signed in"}
      </button>
    </div>
  );
}
