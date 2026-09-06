import { useEffect, useRef } from "react";
import { deleteConfirmation, type DeleteSubject } from "@app/shared";

/** Everything inside the dialog Tab can land on, in document order. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface Props {
  /** What is about to be deleted. Null closes the dialog; the caller holds the choice. */
  subject: DeleteSubject | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * **The question asked before a broadcast is taken off the channel** (PRD-16 §5, issue 064; §9,
 * issue 071).
 *
 * Its own component because two panels ask it — the "Made here" list on the Schedule page, and
 * every row of the Broadcasts page since issue 071 — and this is the one dialog in the app whose
 * press cannot be taken back. A second implementation would be a second set of words, a second
 * focus trap, and one of them eventually missing the struck-through link.
 *
 * What it breaks is not on the screen: the link is already out there, in a bulletin and three
 * group chats. So the question shows the link itself, struck through, because that is precisely
 * what the press does to it. The sibling of the stream-binding confirmation in issue 051, and a
 * confirmation for the same reason: everyone here is trusted, and what is being defended against
 * is a mis-click.
 */
export function DeleteBroadcastDialog({ subject, onCancel, onConfirm }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // While the question is up it owns the keyboard. Capture-phase, so Escape answers *this*
  // question rather than closing whatever this panel happens to be sitting inside.
  useEffect(() => {
    if (!subject) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const stops = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [subject, onCancel]);

  // Focus opens into the dialog and returns where it came from, so the question is answerable
  // from the keyboard alone. `Keep it` is first, and therefore what focus lands on.
  useEffect(() => {
    if (!subject) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => restoreTo?.focus?.();
  }, [subject !== null]);

  if (!subject) return null;
  const confirmation = deleteConfirmation(subject);

  return (
    <div className="overlay">
      <div
        className="modal prep-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prep-confirm-title"
        ref={dialogRef}
      >
        <div className="settings__head">
          <span className="eyebrow">Confirm</span>
          <h2 id="prep-confirm-title">{confirmation.question}</h2>
        </div>
        <div className="prep-confirm__body">
          {/* The link, shown the way the panel showed it when it was made — and struck out,
              because that is precisely what the press does to it. */}
          <code className="mono prep__link-url prep-confirm__dead">{subject.watchUrl}</code>
          <p>{confirmation.warning}</p>
        </div>
        <div className="modal__foot">
          <button className="btn" type="button" onClick={onCancel}>
            Keep it
          </button>
          <button className="btn btn--danger" type="button" onClick={onConfirm}>
            Delete from YouTube
          </button>
        </div>
      </div>
    </div>
  );
}
