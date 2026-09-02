import { useEffect, useRef, useState } from "react";
import type { StreamInfo } from "../api.js";
import { describeBindingChange, isStaleBinding, streamOptionLabel } from "../lib/streamBinding.js";

interface Props {
  /** DOM id for the input, so the two dashboards can keep their existing ids. */
  id: string;
  label: string;
  /** The saved binding — the field never shows anything else once a change is settled. */
  value: string | null;
  streams: StreamInfo[];
  /**
   * Called only after the operator has confirmed the change. May return a promise; the field waits
   * for it and then shows whatever `value` actually is, so a save the server refused does not leave
   * the operator reading a binding nobody holds.
   */
  onCommit: (next: string | null) => void | Promise<unknown>;
}

/** Everything inside the dialog that Tab can land on, in document order. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The default stream binding, with a confirmation in front of every change (issue 051, PRD-15 §9).
 *
 * Every other field here fails loudly: a bad category is refused, a bad title is visible on the
 * broadcast. This one fails silently and expensively — a wrong binding sends the show to a stream
 * nobody is watching, and nothing in the app looks broken until the audience says so. So the value
 * is not saved on blur the way the fields beside it are; it is saved on a deliberate press, and the
 * confirmation names what is changing **from** as well as **to**, because "are you sure?" on its own
 * tells the operator nothing they did not already know.
 *
 * A confirmation, not a role check. Everyone on this deployment is trusted; the thing being
 * defended against is a mis-click, and a permission would only move the mis-click to someone else.
 *
 * One component rather than the copy it replaces in each dashboard: a guard that lives in two
 * places is a guard that is on in one of them.
 */
export function StreamBindingField({ id, label, value, streams, onCommit }: Props) {
  const [draft, setDraft] = useState(value ?? "");
  // undefined = nothing pending. null is a real pending value ("clear the binding"), so the
  // absence of a change cannot be spelled the same way.
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // The saved value as of *now*, for the async settle below: by the time a commit resolves the
  // `value` captured in that closure may be a version of the truth two states old.
  const savedRef = useRef(value);
  savedRef.current = value;

  // Follows the saved value: another tab, or another operator, can move it underneath this field.
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const cancel = () => {
    setPending(undefined);
    setDraft(value ?? "");
  };

  // While the question is up, this field owns the keyboard and the pointer. Escape and clicks
  // outside must not reach the modal this field sits inside — closing the settings panel out from
  // under a question it just asked would read as an answer, and the change would vanish unsaved.
  // Capture-phase, so these run before the document-level and React-root listeners that would.
  useEffect(() => {
    if (pending === undefined) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
        return;
      }
      // Tab stays inside the dialog. Without this, focus walks onto the controls the overlay is
      // covering: Enter then presses a button the operator cannot see, and a screen-reader user is
      // left on content `aria-modal` has hidden with no way back to Cancel.
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

    // A click anywhere but the dialog answers "cancel" — and answers it here, rather than letting
    // the same click also close the settings panel behind us. The blur that raises this question is
    // often itself a mousedown on that panel's backdrop, whose click lands a moment later.
    const onClick = (e: MouseEvent) => {
      if (dialogRef.current?.contains(e.target as Node)) return;
      e.stopPropagation();
      e.preventDefault();
      cancel();
    };

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("click", onClick, true);
    };
  });

  // Put focus on the dialog when it opens, and hand it back to the field when it closes: the
  // question is answerable from the keyboard alone, and answering it returns you where you were.
  useEffect(() => {
    if (pending === undefined) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => restoreTo?.focus?.();
  }, [pending === undefined]);

  const ask = () => {
    const next = draft.trim() || null;
    if (next === value) {
      // Whitespace-only edits and re-blurs are not changes; normalise the field and stay quiet.
      setDraft(value ?? "");
      return;
    }
    setPending(next);
  };

  const confirm = async () => {
    const next = pending ?? null;
    setPending(undefined);
    try {
      await onCommit(next);
    } finally {
      // Whatever the save did, the field shows the binding that is actually saved. A refused save
      // leaves `value` alone, and the operator must not be left reading the id they asked for.
      setDraft(savedRef.current ?? "");
    }
  };

  const change = pending === undefined ? null : describeBindingChange(value, pending, streams);
  const stale = isStaleBinding(value, streams);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        list={`${id}-list`}
        value={draft}
        placeholder="stream id / key"
        aria-invalid={stale}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={ask}
      />
      <datalist id={`${id}-list`}>
        {streams.map((s) => (
          <option key={s.id} value={s.id}>
            {streamOptionLabel(s)}
          </option>
        ))}
      </datalist>
      {stale ? (
        <p className="field-warn">
          ⚠ No live stream on this channel has that ID — updates that rely on the default binding
          will fail.
        </p>
      ) : null}

      {change ? (
        <div className="overlay">
          <div
            className="modal binding-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-confirm-title`}
            ref={dialogRef}
          >
            <div className="settings__head">
              <span className="eyebrow">Confirm</span>
              <h2 id={`${id}-confirm-title`}>Change the default stream binding?</h2>
            </div>
            <div className="binding-confirm__body">
              <p>
                This is the stream every action falls back to. Point it at the wrong one and the
                show goes somewhere nobody is watching — and nothing here will look broken.
              </p>
              <dl className="binding-confirm__diff">
                <dt>From</dt>
                <dd>{change.from}</dd>
                <dt>To</dt>
                <dd>{change.to}</dd>
              </dl>
              {change.clearing ? (
                <p className="field-warn">
                  ⚠ Clearing it leaves presets and ad-hoc updates with no binding to inherit.
                </p>
              ) : null}
              {pending != null && isStaleBinding(pending, streams) ? (
                <p className="field-warn">
                  ⚠ No live stream on this channel carries that ID right now.
                </p>
              ) : null}
            </div>
            <div className="modal__foot">
              <button className="btn" type="button" onClick={cancel}>
                Cancel
              </button>
              <button className="btn btn--primary" type="button" onClick={confirm}>
                Change the binding
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
