import { useMemo, useState } from "react";
import type { Preset, PresetActionResult, VarSource } from "../api.js";
import { extractVars, resolvePresetText } from "../lib/template.js";
import { useEscape } from "../lib/useEscape.js";

interface Props {
  preset: Preset;
  /** Fires the action; resolves with the endpoint's success/error body. */
  fire: (presetId: string, vars: Record<string, string>) => Promise<PresetActionResult>;
  onClose: () => void;
}

const lastUsedKey = (id: string) => `yt-fill-last:${id}`;

function loadLastUsed(id: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(lastUsedKey(id));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const SOURCE_LABEL: Record<VarSource, string> = {
  provided: "typed",
  default: "default",
  fallback: "fallback",
};

/**
 * Fill popup for a templated preset (PRD §5). One input per detected variable, greyed
 * placeholders for inline defaults / fallbacks, last-used values prefilled per preset, and
 * a live preview of the resolved title/description that mirrors the server engine exactly.
 */
export function PresetFillModal({ preset, fire, onClose }: Props) {
  const vars = useMemo(() => extractVars(preset), [preset]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const last = loadLastUsed(preset.id);
    return Object.fromEntries(vars.map((v) => [v.name, last[v.name] ?? ""]));
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PresetActionResult | null>(null);
  useEscape(onClose);

  const preview = useMemo(() => resolvePresetText(preset, values), [preset, values]);
  const sourceOf = (name: string): VarSource | undefined =>
    preview.resolvedVars.find((v) => v.name === name)?.source;

  const set = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    setResult(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const sending = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v.trim() !== ""),
    );
    try {
      const r = await fire(preset.id, sending);
      setResult(r);
      if (r.success) {
        try {
          localStorage.setItem(lastUsedKey(preset.id), JSON.stringify(values));
        } catch {
          /* storage full or blocked — last-used prefill is best-effort */
        }
      }
    } catch (err) {
      setResult({ success: false, error: { code: "NETWORK", message: (err as Error).message } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="panel__head">
          <h2>Fill “{preset.title}”</h2>
        </div>
        <div className="panel__body">
          <p className="empty" style={{ marginTop: 0 }}>
            Fill the variables, then apply. Blank uses the greyed default or the field’s
            fallback.
          </p>

          {vars.map((v, i) => {
            const source = sourceOf(v.name);
            const placeholder =
              v.default != null
                ? v.default
                : v.required
                  ? "required"
                  : "leave blank for fallback";
            return (
              <div className="field" key={v.name}>
                <label htmlFor={`fill-${v.name}`}>
                  {v.name}
                  {source ? <span className={`vchip vchip--${source}`}>{SOURCE_LABEL[source]}</span> : null}
                </label>
                <input
                  id={`fill-${v.name}`}
                  value={values[v.name] ?? ""}
                  placeholder={placeholder}
                  aria-invalid={v.required && values[v.name].trim() === ""}
                  autoFocus={i === 0}
                  onChange={(e) => set(v.name, e.target.value)}
                />
              </div>
            );
          })}

          {/* Signature: a live readout of the resolved output, echoing the status rail. */}
          <div className="fill-preview" aria-live="polite">
            <div className="fill-preview__field">
              <span className="fill-preview__label">Resolved title</span>
              <span className="fill-preview__text">
                {preview.title || <span className="fill-preview__empty">—</span>}
              </span>
            </div>
            <div className="fill-preview__field">
              <span className="fill-preview__label">Resolved description</span>
              <span className="fill-preview__text">
                {preview.description || <span className="fill-preview__empty">—</span>}
              </span>
            </div>
          </div>

          {preview.missing.length > 0 ? (
            <p className="field-warn">
              ⚠ {preview.missing.join(", ")} {preview.missing.length === 1 ? "has" : "have"} no
              value and no fallback — applying will report it as missing.
            </p>
          ) : null}

          {result ? (
            result.success ? (
              <p className="fill-result fill-result--ok">Applied “{preview.title}” to YouTube.</p>
            ) : (
              <p className="fill-result fill-result--err">
                {result.error?.message ?? "Action failed."}
              </p>
            )
          ) : null}
        </div>
        <div className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {result?.success ? "Close" : "Cancel"}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Applying…" : "Apply now"}
          </button>
        </div>
      </form>
    </div>
  );
}
