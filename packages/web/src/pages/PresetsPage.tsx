import { useRef } from "react";
import { buildFillUrl } from "../lib/fillRoute.js";
import { useDashboard } from "./context.js";

const PRIVACY_PILL: Record<string, string> = {
  public: "pill--pub",
  unlisted: "pill--unl",
  private: "pill--priv",
};

/**
 * The presets, and the two strings a Companion key needs to fire one (navbar + pages).
 *
 * Given a page of its own because a preset library grows: at a dozen cards it was the panel that
 * pushed everything else off the single-page dashboard, and it is the one screen an operator sits
 * on to do a stretch of work rather than glance at.
 */
export function PresetsPage() {
  const {
    presets,
    state,
    apiEnabled,
    defaultCategoryLabel,
    defaultStreamLabel,
    applyPreset,
    duplicatePreset,
    deletePreset,
    exportPresets,
    importPresets,
    newPreset,
    editPreset,
    copy,
  } = useDashboard();
  const importInput = useRef<HTMLInputElement>(null);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Presets</h2>
        <div className="panel__head-actions">
          <button
            className="btn btn--sm"
            onClick={exportPresets}
            disabled={presets.length === 0}
            title="Download all presets as a JSON backup"
          >
            Export
          </button>
          <button
            className="btn btn--sm"
            onClick={() => importInput.current?.click()}
            title="Restore or clone presets from a JSON file"
          >
            Import
          </button>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importPresets(file);
              e.target.value = "";
            }}
          />
          <button className="btn btn--primary btn--sm" onClick={newPreset}>
            + New preset
          </button>
        </div>
      </div>
      <div className="panel__body">
        {presets.length === 0 ? (
          <p className="empty">
            No presets yet. Create one to map it to a Stream Deck button.
          </p>
        ) : (
          <div className="preset-grid">
            {presets.map((p) => (
              <article className="card" key={p.id}>
                <div className="card__title" dir="auto">
                  {p.title}
                </div>
                {p.description ? (
                  <div className="card__desc" dir="auto">
                    {p.description}
                  </div>
                ) : null}
                <div className="card__meta">
                  <span className={`pill ${PRIVACY_PILL[p.privacyStatus]}`}>
                    {p.privacyStatus}
                  </span>
                  <span
                    className="pill"
                    title={
                      p.category
                        ? `Category override: ${p.category}`
                        : `Inherits default category: ${defaultCategoryLabel ?? "none (leave untouched)"}`
                    }
                  >
                    {p.category
                      ? `cat ${p.category}`
                      : `cat · default: ${defaultCategoryLabel ?? "none"}`}
                  </span>
                  <span
                    className="pill"
                    title={
                      p.streamBoundId
                        ? `Stream override: ${p.streamBoundId}`
                        : `Inherits default binding: ${defaultStreamLabel ?? "none (leave untouched)"}`
                    }
                  >
                    {p.streamBoundId
                      ? "stream · override"
                      : `stream · default: ${defaultStreamLabel ?? "none"}`}
                  </span>
                </div>
                <div
                  className="mapping"
                  title="Fill-route deep link — paste into a Companion HTTP GET action"
                >
                  <code>{buildFillUrl(location.origin, p.id)}</code>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => copy(buildFillUrl(location.origin, p.id), "Fill URL")}
                  >
                    Copy URL
                  </button>
                </div>
                <div
                  className="mapping"
                  title="Direct-API JSON payload for the Companion body"
                >
                  <code>{`{ "presetId": "${p.id}" }`}</code>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => copy(`{ "presetId": "${p.id}" }`, "Payload")}
                  >
                    Copy JSON
                  </button>
                </div>
                <div className="card__actions">
                  <button
                    className="btn btn--sm"
                    onClick={() => applyPreset(p)}
                    disabled={(state?.busy ?? false) || !apiEnabled}
                    title={apiEnabled ? undefined : "YouTube API is paused"}
                  >
                    Apply now
                  </button>
                  <button className="btn btn--sm" onClick={() => editPreset(p)}>
                    Edit
                  </button>
                  <button
                    className="btn btn--sm"
                    onClick={() => duplicatePreset(p)}
                    title="Create an editable copy of this preset"
                  >
                    Duplicate
                  </button>
                  <button
                    className="btn btn--sm btn--danger"
                    onClick={() => deletePreset(p)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
