import { useState } from "react";
import type { Category, DashboardState, PrivacyStatus, StreamInfo } from "../api.js";
import { CategorySelect } from "./CategorySelect.js";
import { StreamSelect } from "./StreamSelect.js";
import { isStaleBinding } from "../lib/streamBinding.js";
import { useEscape } from "../lib/useEscape.js";

const PRIVACY: PrivacyStatus[] = ["public", "unlisted", "private"];

interface Props {
  state: DashboardState | null;
  categories: Category[];
  streams: StreamInfo[];
  /** Human label of the app default category/stream, so "inherit default" shows its value. */
  defaultCategoryLabel: string | null;
  defaultStreamLabel: string | null;
  onCancel: () => void;
  onSubmit: (payload: {
    title: string;
    description?: string;
    privacyStatus?: PrivacyStatus;
    category?: string | null;
    streamBoundId?: string | null;
  }) => Promise<void>;
}

export function AdHocModal({
  state,
  categories,
  streams,
  defaultCategoryLabel,
  defaultStreamLabel,
  onCancel,
  onSubmit,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacyStatus, setPrivacy] = useState<PrivacyStatus>("public");
  const [category, setCategory] = useState<string | null>(null);
  const [streamBoundId, setStream] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscape(onCancel);

  const live = state?.status.isLive ?? false;
  const staleBinding = isStaleBinding(streamBoundId, streams);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onSubmit({
        title: title.trim(),
        description,
        privacyStatus,
        category,
        streamBoundId,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="panel__head">
          <h2>Ad-hoc update</h2>
        </div>
        <div className="panel__body">
          <span className="target-badge">
            <span className={`lamp ${live ? "lamp--live" : "lamp--ready"}`} />
            {live ? "Will update the ACTIVE live stream" : "Will update the persistent container"}
          </span>
          <div className="field">
            <label htmlFor="ah-title">Title</label>
            <input id="ah-title" dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
          </div>
          <div className="field">
            <label htmlFor="ah-desc">Description</label>
            <textarea id="ah-desc" dir="auto" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ah-privacy">Privacy status</label>
            <select id="ah-privacy" value={privacyStatus} onChange={(e) => setPrivacy(e.target.value as PrivacyStatus)}>
              {PRIVACY.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="field--row">
            <div className="field">
              <label htmlFor="ah-cat">
                Category{" "}
                <span className="hint">
                  — blank inherits default: {defaultCategoryLabel ?? "none"}
                </span>
              </label>
              <CategorySelect
                id="ah-cat"
                value={category}
                categories={categories}
                blankLabel={`— inherit default: ${defaultCategoryLabel ?? "none"} —`}
                onChange={setCategory}
              />
            </div>
            <div className="field">
              <label htmlFor="ah-stream">
                Stream binding{" "}
                <span className="hint">
                  — blank inherits default: {defaultStreamLabel ?? "none"}
                </span>
              </label>
              <StreamSelect
                id="ah-stream"
                value={streamBoundId}
                streams={streams}
                blankLabel={`— inherit default: ${defaultStreamLabel ?? "none"} —`}
                onChange={setStream}
              />
              {staleBinding ? (
                <p className="field-warn">
                  ⚠ No live stream on this channel has that ID — the binding will fail when
                  triggered. Pick one from the list or clear it.
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Pushing…" : "Push update"}
          </button>
        </div>
      </form>
    </div>
  );
}
