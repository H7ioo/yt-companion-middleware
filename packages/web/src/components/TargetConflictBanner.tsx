import { TARGET_CONFLICT_GLOSSARY, type TargetConflict } from "@app/shared";

interface Props {
  conflict: TargetConflict;
  /** Re-resolves the target from YouTube — the check to run after deleting a stray broadcast. */
  onRefresh: () => void;
  refreshing: boolean;
}

/**
 * Target-conflict warning (PRD-12 §3). Amber, never red: the app is talking to YouTube perfectly
 * well, it just cannot be sure which broadcast the encoder will feed. Red in this rack means "you
 * have lost YouTube" and must keep meaning only that.
 *
 * The broadcast ids are shown rather than described. There is no button that fixes this — the
 * strays live in YouTube Studio and only the operator can delete them — so the useful thing the
 * banner can do is hand over the exact ids they need to match against, and let them re-check.
 */
export function TargetConflictBanner({ conflict, onRefresh, refreshing }: Props) {
  const term = TARGET_CONFLICT_GLOSSARY[conflict.code];

  return (
    <div className="conflict" role="status">
      <span className="conflict__lamp" aria-hidden="true" />
      <div className="conflict__meta">
        <span className="eyebrow">Target check</span>
        <span className="conflict__title">{term.label}</span>
        <span className="conflict__note">{conflict.message}</span>
        {conflict.ids.length > 0 ? (
          <ul className="conflict__ids" aria-label="Broadcasts involved">
            {conflict.ids.map((id) => (
              <li key={id} className="mono">
                {id}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="conflict__action">
        <button type="button" className="btn btn--ghost" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? "Checking…" : "Re-check"}
        </button>
      </div>
    </div>
  );
}
