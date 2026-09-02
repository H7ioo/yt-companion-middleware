import { useEffect, useState } from "react";
import type { StreamInfo } from "../api.js";
import { describeBindingChange, isStaleBinding, streamOptionLabel } from "../lib/streamBinding.js";

interface Props {
  /** DOM id for the input, so the two dashboards can keep their existing ids. */
  id: string;
  label: string;
  /** The saved binding — the field never shows anything else once a change is settled. */
  value: string | null;
  streams: StreamInfo[];
  /** Called only after the operator has confirmed the change. */
  onCommit: (next: string | null) => void;
}

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

  // Follows the saved value: another tab, or another operator, can move it underneath this field.
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const cancel = () => {
    setPending(undefined);
    setDraft(value ?? "");
  };

  // Escape cancels the confirmation without reaching the Escape handler of whatever modal this
  // field sits inside — closing the settings panel out from under a question it just asked would
  // read as an answer. Capture-phase, so it runs before those document-level listeners.
  useEffect(() => {
    if (pending === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      cancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });

  const ask = () => {
    const next = draft.trim() || null;
    if (next === value) {
      // Whitespace-only edits and re-blurs are not changes; normalise the field and stay quiet.
      setDraft(value ?? "");
      return;
    }
    setPending(next);
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
        <div className="overlay" onClick={cancel}>
          <div
            className="modal binding-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-confirm-title`}
            onClick={(e) => e.stopPropagation()}
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
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => {
                  const next = pending ?? null;
                  setPending(undefined);
                  onCommit(next);
                }}
              >
                Change the binding
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
