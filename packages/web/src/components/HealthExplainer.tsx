import { useId, useState } from "react";
import type { HealthStatus } from "@app/shared";
import { explainHealth } from "../lib/healthExplainer.js";

/**
 * The health explainer (PRD-06 §4, issue 020). The Health readout's value doubles as a toggle:
 * clicking it drops a plain-language line explaining the current state, its copy drawn from the
 * canonical glossary in @app/shared so it always matches the operator guide. For `offline` and
 * `auth_error` it links to the firewall / reconnect panel App.tsx already mounts for that fault.
 */
export function HealthExplainer({
  health,
  lampClass,
}: {
  health: HealthStatus;
  lampClass: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { label, meaning, link } = explainHealth(health);

  return (
    <div className="health">
      <button
        type="button"
        className="health__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`lamp ${lampClass}`} />
        {label}
        <span className="health__hint" aria-hidden="true">
          {open ? "–" : "?"}
        </span>
      </button>
      {open ? (
        <p id={panelId} className="health__explain">
          {meaning}
          {link ? (
            <a className="health__link" href={link.href}>
              {link.label} &rarr;
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
