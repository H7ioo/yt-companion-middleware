import { HEALTH_GLOSSARY, type HealthStatus, type HealthTerm } from "@app/shared";

/** An in-page jump to the panel that fixes the current fault, or null when there's nothing to do. */
export interface HealthLink {
  /** Anchor of the target panel already rendered on the dashboard (offline → firewall, etc.). */
  href: string;
  label: string;
}

export interface HealthExplanation {
  label: string;
  meaning: string;
  link: HealthLink | null;
}

// Each remedy maps to the panel App.tsx already mounts for that fault, so the explainer just
// points at it instead of duplicating the fix. The anchors live on those panels (see App.tsx).
const REMEDY_LINK: Partial<Record<HealthTerm["remedy"], HealthLink>> = {
  firewall: { href: "#firewall", label: "See firewall steps" },
  reconnect: { href: "#reauth", label: "Reconnect YouTube" },
};

/**
 * Turn a health code into the plain-language explanation shown on the dashboard health indicator
 * (PRD-06 §4, issue 020). Copy comes from the canonical glossary in @app/shared so it always
 * matches the operator guide; an unrecognised code degrades to its raw value rather than throwing.
 */
export function explainHealth(health: HealthStatus): HealthExplanation {
  const term = HEALTH_GLOSSARY[health] as HealthTerm | undefined;
  if (!term) {
    return { label: health, meaning: "Unrecognised health state.", link: null };
  }
  return {
    label: term.label,
    meaning: term.meaning,
    link: REMEDY_LINK[term.remedy] ?? null,
  };
}
