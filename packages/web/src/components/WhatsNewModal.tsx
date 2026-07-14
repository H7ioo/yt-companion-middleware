import type { ReleaseNotes } from "../api.js";
import { splitScope } from "../lib/whatsNew.js";
import { useEscape } from "../lib/useEscape.js";

interface Props {
  /**
   * The running version's notes are structured {@link ReleaseNotes} from the bundled changelog;
   * the offered version's notes arrive as plain text from the update feed (PRD-10 §3). Either
   * renders here.
   */
  notes: ReleaseNotes | string | null;
  /** "running" = what you are on now; "offered" = what an install would give you. */
  kind: "running" | "offered";
  onClose: () => void;
  /** Manual update re-check; absent on hosts with no updater (Docker, portable, dev). */
  onCheckUpdates?: () => void;
  checkingUpdates?: boolean;
}

/**
 * What's New (PRD-09 §B.2, issue 040). Reads from the changelog bundled into the build, so it is
 * accurate for the exact binary in front of the operator and works with no network — the dashboard
 * is often the only thing up when the internet is not.
 *
 * Shown once after an update (see shouldAnnounce) and on demand from the rail's version chip. The
 * update banner opens the same panel for the version it is offering, so "what would I get" and
 * "what did I get" are one screen, not two.
 */
export function WhatsNewModal({ notes, kind, onClose, onCheckUpdates, checkingUpdates }: Props) {
  useEscape(onClose);

  // Plain-text feed notes (offered version) vs. structured changelog notes (running version).
  const structured = notes !== null && typeof notes !== "string" ? notes : null;
  const plain = typeof notes === "string" ? notes.trim() : "";

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="panel__head">
          <h2>{kind === "offered" ? "In the update" : "What's new"}</h2>
          {structured ? (
            <span className="whatsnew__stamp mono">
              v{structured.version} <span aria-hidden="true">·</span> {structured.date}
            </span>
          ) : null}
        </div>

        <div className="panel__body whatsnew">
          {plain ? (
            // Feed notes arrive as plain text; each blank-line-separated block is a paragraph.
            plain.split(/\n{2,}/).map((para, i) => (
              <p className="whatsnew__para" key={i} dir="auto">
                {para}
              </p>
            ))
          ) : !structured || structured.sections.length === 0 ? (
            <p className="whatsnew__empty">
              No release notes shipped with this version.
            </p>
          ) : (
            structured.sections.map((section) => (
              <section className="whatsnew__section" key={section.title}>
                <span className="eyebrow">{section.title}</span>
                <ul className="whatsnew__list">
                  {section.items.map((item) => {
                    const { scope, text } = splitScope(item);
                    return (
                      <li key={item}>
                        {scope ? <span className="whatsnew__scope mono">{scope}</span> : null}
                        <span dir="auto">{text}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        <div className="modal__foot">
          {onCheckUpdates ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onCheckUpdates}
              disabled={checkingUpdates}
            >
              {checkingUpdates ? "Checking…" : "Check for updates"}
            </button>
          ) : null}
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
