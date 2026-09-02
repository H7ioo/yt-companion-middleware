import type { HealthTerm } from "@app/shared";

/**
 * How the rack renders a glossary key colour. The glossary owns which colour a state lights
 * (issue 021); this owns what that colour looks like on the panel — so a recolour there reaches
 * every surface here without a second edit.
 *
 * offline is slate and auth_error is red on purpose: the two failure modes must never read as the
 * same fault (PRD-06 §2 / issue 019 AC #3). Shared rather than per-component since issue 059 gave
 * the ingestion states the same treatment.
 */
export const LAMP_FOR_KEY_COLOR: Record<HealthTerm["keyColor"], string> = {
  Green: "lamp--ready",
  Yellow: "lamp--warn",
  Grey: "lamp--offline",
  Red: "lamp--err",
};
