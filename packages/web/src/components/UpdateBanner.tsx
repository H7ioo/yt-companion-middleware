import { useState } from "react";
import type { AppInfo } from "../api.js";
import { api } from "../api.js";
import { describeUpdate, hasUpdateNotes } from "../lib/whatsNew.js";

interface Props {
  info: AppInfo;
  /** Opens What's New on the version being offered — the notes for what you'd get. */
  onShowNotes: () => void;
  /** Re-runs the update check after a failed download (App's manual-check handler). */
  onRetry: () => void;
  /** Whether that re-check is in flight, so the retry button can't be double-clicked. */
  retrying: boolean;
  flash: (message: string, kind?: "ok" | "err") => void;
}

/**
 * Update affordance (PRD-09 §A.1, issue 040). Blue, never red: an available update is information,
 * not a fault — the red lamp in this dashboard means "you have lost YouTube" and must keep meaning
 * only that. Nothing here happens on its own; the app downloads in the background and then waits
 * for this button, because a restart mid-stream is the one thing the updater must never cause.
 *
 * Renders nothing on hosts with no updater (Docker, portable, dev) or with nothing to offer.
 */
export function UpdateBanner({ info, onShowNotes, onRetry, retrying, flash }: Props) {
  const [busy, setBusy] = useState(false);
  const banner = describeUpdate(info.update);
  if (!banner) return null;

  const install = async () => {
    setBusy(true);
    try {
      await api.app.install();
      flash("Installing update — the app will restart");
    } catch (e) {
      setBusy(false);
      flash((e as Error).message, "err");
    }
    // On success the app is quitting; leave the button disabled rather than flicking it back.
  };

  return (
    <div className="update" role="status">
      <span className="update__lamp" aria-hidden="true" />
      <div className="update__meta">
        <span className="eyebrow">Update</span>
        <span className="update__title">{banner.title}</span>
        <span className="update__note">{banner.note}</span>
      </div>
      <div className="update__actions">
        {hasUpdateNotes(info) ? (
          <button type="button" className="btn btn--ghost" onClick={onShowNotes}>
            What&rsquo;s in it
          </button>
        ) : null}
        {banner.installable ? (
          <button type="button" className="btn btn--primary" onClick={install} disabled={busy}>
            {busy ? "Installing…" : "Install & restart"}
          </button>
        ) : null}
        {banner.retryable ? (
          <button type="button" className="btn btn--primary" onClick={onRetry} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry download"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
