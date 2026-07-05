import { useState } from "react";
import type { Category, Preset, PresetInput, PrivacyStatus, StreamInfo } from "../api.js";
import { CategorySelect } from "./CategorySelect.js";

const PRIVACY: PrivacyStatus[] = ["public", "unlisted", "private"];

interface Props {
  initial?: Preset;
  title: string;
  categories: Category[];
  streams: StreamInfo[];
  /** Human label of the app default category/stream, so "inherit default" shows its value. */
  defaultCategoryLabel: string | null;
  defaultStreamLabel: string | null;
  onCancel: () => void;
  onSubmit: (input: PresetInput) => Promise<void>;
}

export function PresetForm({
  initial,
  title,
  categories,
  streams,
  defaultCategoryLabel,
  defaultStreamLabel,
  onCancel,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<PresetInput>({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    titleFallback: initial?.titleFallback ?? null,
    descriptionFallback: initial?.descriptionFallback ?? null,
    privacyStatus: initial?.privacyStatus ?? "public",
    category: initial?.category ?? null,
    streamBoundId: initial?.streamBoundId ?? null,
  });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof PresetInput>(key: K, value: PresetInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Warn (don't block) if the bound stream id isn't among the channel's live streams — a
  // stale/deleted key silently fails at trigger time otherwise. Empty = inherits default.
  const boundId = form.streamBoundId;
  const staleBinding =
    boundId != null && streams.length > 0 && !streams.some((s) => s.id === boundId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await onSubmit(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="panel__head">
          <h2>{title}</h2>
        </div>
        <div className="panel__body">
          <div className="field">
            <label htmlFor="pf-title">Title</label>
            <input
              id="pf-title"
              dir="auto"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="pf-title-fb">
              Title fallback{" "}
              <span className="hint">— used whole if any title variable is unresolved</span>
            </label>
            <input
              id="pf-title-fb"
              dir="auto"
              value={form.titleFallback ?? ""}
              placeholder="blank = variable is required"
              onChange={(e) => set("titleFallback", e.target.value || null)}
            />
          </div>
          <div className="field">
            <label htmlFor="pf-desc">Description</label>
            <textarea
              id="pf-desc"
              dir="auto"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="pf-desc-fb">
              Description fallback{" "}
              <span className="hint">— used whole if any description variable is unresolved</span>
            </label>
            <textarea
              id="pf-desc-fb"
              dir="auto"
              value={form.descriptionFallback ?? ""}
              placeholder="blank = variable is required"
              onChange={(e) => set("descriptionFallback", e.target.value || null)}
            />
          </div>
          <div className="field">
            <label htmlFor="pf-privacy">Privacy status</label>
            <select
              id="pf-privacy"
              value={form.privacyStatus}
              onChange={(e) => set("privacyStatus", e.target.value as PrivacyStatus)}
            >
              {PRIVACY.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="field--row">
            <div className="field">
              <label htmlFor="pf-cat">
                Category{" "}
                <span className="hint">
                  — blank inherits default: {defaultCategoryLabel ?? "none"}
                </span>
              </label>
              <CategorySelect
                id="pf-cat"
                value={form.category}
                categories={categories}
                blankLabel={`— inherit default: ${defaultCategoryLabel ?? "none"} —`}
                onChange={(value) => set("category", value)}
              />
            </div>
            <div className="field">
              <label htmlFor="pf-stream">
                Stream binding{" "}
                <span className="hint">
                  — blank inherits default: {defaultStreamLabel ?? "none"}
                </span>
              </label>
              <input
                id="pf-stream"
                dir="auto"
                list="pf-stream-list"
                value={form.streamBoundId ?? ""}
                placeholder={`inherits default: ${defaultStreamLabel ?? "none"}`}
                aria-invalid={staleBinding}
                onChange={(e) => set("streamBoundId", e.target.value.trim() || null)}
              />
              <datalist id="pf-stream-list">
                {streams.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                    {s.streamName ? ` · ${s.streamName}` : ""}
                  </option>
                ))}
              </datalist>
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
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : "Save preset"}
          </button>
        </div>
      </form>
    </div>
  );
}
