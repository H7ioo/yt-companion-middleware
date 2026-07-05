import { useEffect, useRef, useState } from "react";
import { api, type Preset } from "./api.js";
import { PresetFillModal } from "./components/PresetFillModal.js";
import { extractVars } from "./lib/template.js";
import type { FillRoute } from "./lib/fillRoute.js";

interface Props {
  route: FillRoute;
}

/**
 * Terminal states for the Companion deep-link landing. The fill popup itself owns the
 * `fill` interaction; every other outcome is a single-line console readout with a tally
 * lamp, echoing the dashboard's control-surface language.
 */
type Phase =
  | { kind: "loading" }
  | { kind: "firing"; preset: Preset }
  | { kind: "fill"; preset: Preset }
  | { kind: "applied"; preset: Preset }
  | { kind: "error"; message: string };

const goTo = (url: string) => {
  window.location.href = url;
};

export function FillPage({ route }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  // Companion may reload the same deep link; guard the variable-less auto-fire so it runs once.
  const fired = useRef(false);

  useEffect(() => {
    let active = true;

    const fireVarless = async (preset: Preset) => {
      try {
        const r = await api.action.preset(preset.id);
        if (!active) return;
        if (r.success) {
          if (route.redirect) return goTo(route.redirect);
          setPhase({ kind: "applied", preset });
        } else {
          setPhase({ kind: "error", message: r.error?.message ?? "Action failed." });
        }
      } catch (e) {
        if (active) setPhase({ kind: "error", message: (e as Error).message });
      }
    };

    api.presets
      .list()
      .then((presets) => {
        if (!active) return;
        const preset = presets.find((p) => p.id === route.presetId);
        if (!preset) {
          setPhase({
            kind: "error",
            message: `No preset matches “${route.presetId}”. Check the button’s preset id.`,
          });
          return;
        }
        if (extractVars(preset).length === 0) {
          setPhase({ kind: "firing", preset });
          if (!fired.current) {
            fired.current = true;
            void fireVarless(preset);
          }
        } else {
          setPhase({ kind: "fill", preset });
        }
      })
      .catch((e) => {
        if (active) setPhase({ kind: "error", message: (e as Error).message });
      });

    return () => {
      active = false;
    };
  }, [route.presetId, route.redirect]);

  // The popup fires the action and returns its result; on success we bounce to Companion.
  const fire = async (presetId: string, vars: Record<string, string>) => {
    const r = await api.action.preset(presetId, vars);
    if (r.success && route.redirect) goTo(route.redirect);
    return r;
  };

  if (phase.kind === "fill") {
    return (
      <FillShell>
        <PresetFillModal preset={phase.preset} fire={fire} onClose={() => goTo("/")} />
      </FillShell>
    );
  }

  const lamp =
    phase.kind === "applied"
      ? "lamp--ready"
      : phase.kind === "error"
        ? "lamp--err"
        : "lamp--warn";

  const heading =
    phase.kind === "loading"
      ? "Opening fill…"
      : phase.kind === "firing"
        ? `Applying “${phase.preset.title}”…`
        : phase.kind === "applied"
          ? `Applied “${phase.preset.title}”`
          : "Can’t apply";

  const detail =
    phase.kind === "error"
      ? phase.message
      : phase.kind === "applied"
        ? route.redirect
          ? "Returning to Companion…"
          : "Live target updated on YouTube."
        : "Firing the preset action.";

  return (
    <FillShell>
      <div className="console" role="status" aria-live="polite">
        <span className="eyebrow">Companion · fill</span>
        <div className="console__line">
          <span className={`lamp ${lamp}`} />
          <h1 className="console__head">{heading}</h1>
        </div>
        <p className="console__detail">{detail}</p>
        {phase.kind === "error" ? (
          <a className="btn btn--sm" href="/">
            Open dashboard
          </a>
        ) : null}
      </div>
    </FillShell>
  );
}

function FillShell({ children }: { children: React.ReactNode }) {
  return <div className="fill-stage">{children}</div>;
}
