import { useEffect, useRef, useState } from "react";
import { deleteConfirmation, type PreparedBroadcast } from "@app/shared";
import { isoToLocalInput } from "../lib/prepareForm.js";

interface Props {
  /** Everything this app has made, newest first — including what has been removed. */
  items: PreparedBroadcast[];
  /** The link last copied, so only that row's button says "Copied". */
  copiedUrl: string | null;
  onCopy: (url: string) => void;
  /** Deletes it from YouTube. Called only after the operator has answered the question. */
  onDelete: (id: string) => Promise<void>;
}

/** Everything inside the dialog Tab can land on, in document order. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * **What this app made, and what became of it** (PRD-16 §5, issue 064).
 *
 * The list is the record, so nothing ever leaves it. A retired broadcast stays exactly where it
 * was with its link struck out and the reason in its own words — a cleanup the operator cannot
 * see afterwards is indistinguishable from a broadcast that went missing, and "where did Friday
 * go?" is the question this feature would otherwise create.
 *
 * Deleting is the one press in this panel that cannot be taken back, and what it breaks is not on
 * the screen: the link is already out there, in a bulletin and three group chats. So the question
 * shows the link itself, struck through — the panel's own loud element, dying. The sibling of the
 * stream-binding confirmation in issue 051, and a confirmation for the same reason: everyone here
 * is trusted, and what is being defended against is a mis-click.
 */
export function PreparedList({ items, copiedUrl, onCopy, onDelete }: Props) {
  const [asking, setAsking] = useState<PreparedBroadcast | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // While the question is up it owns the keyboard. Capture-phase, so Escape answers *this*
  // question rather than closing whatever this panel happens to be sitting inside.
  useEffect(() => {
    if (!asking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setAsking(null);
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
  }, [asking]);

  // Focus opens into the dialog and returns where it came from, so the question is answerable
  // from the keyboard alone. `Keep it` is first, and therefore what focus lands on.
  useEffect(() => {
    if (!asking) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => restoreTo?.focus?.();
  }, [asking !== null]);

  if (items.length === 0) return null;

  const confirm = async (record: PreparedBroadcast) => {
    setAsking(null);
    setBusyId(record.id);
    try {
      await onDelete(record.id);
    } finally {
      setBusyId(null);
    }
  };

  const confirmation = asking ? deleteConfirmation(asking) : null;

  return (
    <div className="prep__earlier">
      <span className="eyebrow">Made here</span>
      <ul className="prep__list">
        {items.map((p) => {
          const retired = p.retiredAt !== null;
          const aired = p.airedAt !== null;
          return (
            <li key={p.id} className={`prep__item${retired ? " prep__item--retired" : ""}`}>
              <span className="prep__item-title">{p.title}</span>
              <span className="prep__item-when">
                {retired
                  ? (p.retiredReason ?? "Removed from YouTube.")
                  : aired
                    ? `Aired ${stamp(p.airedAt)}`
                    : p.scheduledStartTime
                      ? stamp(p.scheduledStartTime)
                      : "no start time"}
              </span>
              {retired ? null : (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => onCopy(p.watchUrl)}
                >
                  {copiedUrl === p.watchUrl ? "Copied" : "Copy link"}
                </button>
              )}
              {/* Never offered for one that aired: it is a recording people may still be
                  watching, and deleting it takes that away rather than tidying up. */}
              {retired || aired ? null : (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm prep__item-del"
                  onClick={() => setAsking(p)}
                  disabled={busyId === p.id}
                >
                  {busyId === p.id ? "Deleting…" : "Delete"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {asking && confirmation ? (
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
              <code className="mono prep__link-url prep-confirm__dead">{asking.watchUrl}</code>
              <p>{confirmation.warning}</p>
            </div>
            <div className="modal__foot">
              <button className="btn" type="button" onClick={() => setAsking(null)}>
                Keep it
              </button>
              <button
                className="btn btn--danger"
                type="button"
                onClick={() => void confirm(asking)}
              >
                Delete from YouTube
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The operator's own clock, in the shape the panel's other timestamps use. */
function stamp(iso: string | null): string {
  return iso ? isoToLocalInput(iso).replace("T", ", ") : "";
}
