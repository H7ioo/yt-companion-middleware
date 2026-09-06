import { useEffect, useId, useState } from "react";
import { setupLock } from "@app/shared";
import { api, type BroadcastEditView, type Category, type PrivacyStatus, type StreamInfo } from "../api.js";
import { CategorySelect } from "./CategorySelect.js";
import { StreamSelect } from "./StreamSelect.js";
import { DateTimeField } from "./DateTimeField.js";
import { useEscape } from "../lib/useEscape.js";
import {
  describeEditCost,
  editDiff,
  formFrom,
  type EditFormValues,
} from "../lib/broadcastEditForm.js";

const PRIVACY: PrivacyStatus[] = ["public", "unlisted", "private"];

/** The setup flags, in the order an operator thinks about them: starting, then recording, then reach. */
const FLAGS = [
  { key: "enableAutoStart", label: "Start when the encoder starts" },
  { key: "enableAutoStop", label: "Stop when the encoder stops" },
  { key: "recordFromStart", label: "Record from the start" },
  { key: "enableDvr", label: "Let viewers rewind (DVR)" },
  { key: "enableClosedCaptions", label: "Accept closed captions" },
  { key: "enableEmbed", label: "Allow embedding on other sites" },
  { key: "enableMonitorStream", label: "Preview in Studio before it airs" },
] as const;

interface Props {
  /** The broadcast to edit. The modal reads its own copy — the list carries almost none of this. */
  broadcastId: string;
  streams: StreamInfo[];
  categories: Category[];
  onClose: () => void;
  /** Called after a save lands, so the list re-reads and a retiming's effect is visible at once. */
  onSaved: () => void;
}

/**
 * **Change a broadcast after it exists, without opening Studio** (PRD-16 §9, issue 070).
 *
 * The form is in two halves because YouTube's editable set is in two halves, and pretending
 * otherwise is what makes an edit form read as broken. *What viewers see* — title, description,
 * the times, privacy, category — YouTube takes in every state, including mid-show, which is the
 * edit an operator most often needs at 22:58. *How it runs* — the `contentDetails` flags and the
 * ingestion key — YouTube takes only until an encoder binds, and refuses afterwards.
 *
 * So the second half is the one that locks, and it says why in one sentence at its head rather
 * than greying seven controls in silence. Every disabled control points at that sentence, so the
 * reason is what a screen reader reads out on the field itself. Amber, not red: the lock is the
 * broadcast's state, not the operator's mistake, and the rack already spends amber on "degraded,
 * worth knowing" rather than on "forbidden".
 *
 * The state comes from the resource this modal just read, never from the will-air marker — that
 * marker is the app's own ranking, and YouTube's refusal turns on its own record.
 *
 * Only what moved is sent. The server re-reads and re-sends the whole resource around it, so a
 * body carrying unchanged fields buys nothing — and a category-only edit must not spend a
 * 50-unit broadcast write on a broadcast nobody changed.
 */
export function EditBroadcastModal({ broadcastId, streams, categories, onClose, onSaved }: Props) {
  const [view, setView] = useState<BroadcastEditView | null>(null);
  const [form, setForm] = useState<EditFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lockId = useId();
  useEscape(onClose);

  useEffect(() => {
    let live = true;
    api.broadcasts
      .editable(broadcastId)
      .then((v) => {
        if (!live) return;
        setView(v);
        setForm(formFrom(v));
      })
      .catch((err: unknown) => {
        if (!live) return;
        // Replaces the form rather than sitting above it: there is nothing to edit until the
        // read lands, and a form full of blanks would offer to write them.
        setError(err instanceof Error ? err.message : "Could not read this broadcast.");
      });
    return () => {
      live = false;
    };
  }, [broadcastId]);

  const lock = setupLock(view?.lifeCycleStatus);
  const diff = view && form ? editDiff(view, form) : {};
  const changed = Object.keys(diff).length > 0;

  function set<K extends keyof EditFormValues>(key: K, value: EditFormValues[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function save() {
    if (!changed) return;
    setBusy(true);
    setError(null);
    try {
      await api.broadcasts.edit(broadcastId, diff);
      // The list re-reads on the way out: retiming reorders the will-air ranking, and the
      // consequence of the edit is the thing the operator came to see.
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="modal edit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="panel__head">
          <h2 id="edit-title">Edit broadcast</h2>
        </div>
        <div className="panel__body">
          {error ? <p className="patch__error">{error}</p> : null}

          {!form || !view ? (
            error ? null : (
              <p className="patch__empty">Reading this broadcast…</p>
            )
          ) : (
            <>
              <fieldset className="edit__group">
                <legend className="eyebrow">What viewers see</legend>

                <div className="field">
                  <label htmlFor="edit-title-field">Title</label>
                  <input
                    id="edit-title-field"
                    value={form.title}
                    disabled={busy}
                    onChange={(e) => set("title", e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="edit-description">Description</label>
                  <textarea
                    id="edit-description"
                    value={form.description}
                    disabled={busy}
                    onChange={(e) => set("description", e.target.value)}
                  />
                </div>

                <div className="field--row">
                  <DateTimeField
                    id="edit-start"
                    label="Starts"
                    value={form.startsAt}
                    onChange={(v) => set("startsAt", v)}
                    disabled={busy}
                  />
                  <DateTimeField
                    id="edit-end"
                    label="Ends"
                    value={form.endsAt}
                    onChange={(v) => set("endsAt", v)}
                    disabled={busy}
                  />
                </div>
                {/* Said once, under the pair, because it is the consequence an operator does not
                    expect: moving a start time can hand the automatic choice to a different
                    broadcast. The list re-reads on save, so they see it happen. */}
                <p className="edit__hint">
                  Moving the start time can change which broadcast airs. The list re-reads when you
                  save.
                </p>

                <div className="field--row">
                  <div className="field">
                    <label htmlFor="edit-privacy">Privacy</label>
                    <select
                      id="edit-privacy"
                      value={form.privacyStatus}
                      disabled={busy}
                      onChange={(e) => set("privacyStatus", e.target.value as PrivacyStatus)}
                    >
                      {PRIVACY.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="edit-category">Category</label>
                    <CategorySelect
                      id="edit-category"
                      value={form.category}
                      categories={categories}
                      onChange={(v) => set("category", v)}
                      blankLabel="— as YouTube has it —"
                    />
                  </div>
                </div>
              </fieldset>

              <fieldset
                className={`edit__group${lock.locked ? " edit__group--locked" : ""}`}
                disabled={busy}
              >
                <legend className="eyebrow">How it runs</legend>
                {/* One sentence, at the head of the half it governs, and pointed at by every
                    control it disables — so the reason is read out on the field itself rather
                    than repeated seven times down the panel. */}
                {lock.locked ? (
                  <p className="edit__locked" id={lockId}>
                    {lock.reason}
                  </p>
                ) : null}

                <div className="edit__flags">
                  {FLAGS.map((flag) => (
                    <label className="edit__flag" key={flag.key}>
                      <input
                        type="checkbox"
                        checked={form[flag.key]}
                        disabled={busy || lock.locked}
                        aria-describedby={lock.locked ? lockId : undefined}
                        onChange={(e) => set(flag.key, e.target.checked)}
                      />
                      <span>{flag.label}</span>
                    </label>
                  ))}
                </div>

                <div className="field">
                  <label htmlFor="edit-stream">Ingestion key</label>
                  <StreamSelect
                    id="edit-stream"
                    value={form.streamId}
                    streams={streams}
                    onChange={(v) => set("streamId", v)}
                    blankLabel="— as YouTube has it —"
                    disabled={busy || lock.locked}
                    describedBy={lock.locked ? lockId : undefined}
                  />
                </div>
              </fieldset>
            </>
          )}
        </div>
        <div className="modal__foot edit__foot">
          {/* What the press will spend, before the press — and it moves as the form does, because
              an edit's cost is a function of which resources it touches, not of the form. */}
          <span className="prep__cost">
            {changed ? describeEditCost(diff) : "Nothing has changed yet."}
          </span>
          <span className="edit__buttons">
            <button className="btn" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => void save()}
              disabled={busy || !changed}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
