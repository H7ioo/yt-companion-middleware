import type { ReleaseNotes } from "../api.js";
import { splitScope } from "../lib/whatsNew.js";
import { useEscape } from "../lib/useEscape.js";

interface Props {
  notes: ReleaseNotes | null;
  /** "running" = what you are on now; "offered" = what an install would give you. */
  kind: "running" | "offered";
  onClose: () => void;
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
export function WhatsNewModal({ notes, kind, onClose }: Props) {
  useEscape(onClose);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="panel__head">
          <h2>{kind === "offered" ? "In the update" : "What's new"}</h2>
          {notes ? (
            <span className="whatsnew__stamp mono">
              v{notes.version} <span aria-hidden="true">·</span> {notes.date}
            </span>
          ) : null}
        </div>

        <div className="panel__body whatsnew">
          {!notes || notes.sections.length === 0 ? (
            <p className="whatsnew__empty">
              No release notes shipped with this version.
            </p>
          ) : (
            notes.sections.map((section) => (
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
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
