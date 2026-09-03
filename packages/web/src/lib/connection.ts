import { LIVE_ELIGIBILITY_GLOSSARY } from "@app/shared";
import type { SetupStatus } from "../api.js";

/**
 * How the YouTube connection can be changed from this host.
 *
 * - `in-app`   — the host can drive the system browser (Electron), so consent runs inline.
 * - `redirect` — a hosted deployment (issue 052): no browser to drive, but it knows its public
 *                origin, so consent runs in the admin's *own* browser and returns to the callback.
 * - `manual`   — the credentials are in the app's own store, and there is neither a browser to
 *                drive nor a public origin to return to, so they are replaced by pasting a fresh
 *                refresh token.
 * - `env`      — supplied out-of-band via env vars or the CLI; the store holds nothing, so
 *                nothing here can change them.
 */
export type ConnectionMode = "in-app" | "redirect" | "manual" | "env";

/** Display model for the Settings connection section — pure, so it is testable without a DOM. */
export interface ConnectionView {
  /** Whether the app currently has working YouTube credentials. */
  connected: boolean;
  /** Human label for the active flow, or null when not yet connected. */
  flowLabel: string | null;
  /** Which controls the connection section should offer — see {@link ConnectionMode}. */
  mode: ConnectionMode;
  /**
   * Whether the connection can be changed from within the app at all. True for both store-backed
   * modes: a headless host cannot run consent, but the stored credentials are still the app's to
   * replace. Only env/CLI credentials are genuinely read-only.
   */
  editable: boolean;
  /**
   * What YouTube lets this channel do, named from the glossary (issue 061). Carried on the
   * connection view rather than read separately because it answers the same question the card
   * already answers — "what have I actually got here" — and it is emphatically not a health
   * state: a channel can be connected and green and still be refused broadcast creation.
   */
  eligibilityLabel: string;
}

const FLOW_LABEL: Record<NonNullable<SetupStatus["activeFlow"]>, string> = {
  bundled: "Bundled Google client",
  override: "Your own Google client",
  env: "Environment or CLI",
};

export function describeConnection(status: SetupStatus): ConnectionView {
  // Env/CLI credentials live outside the app's store, so the in-app controls can't touch them.
  // Everything else is store-backed and *is* the app's to change — the host only decides how, and
  // the server is the one that knows. `manual` is the fallback rather than a case of its own: it
  // is what is left when the host can neither drive a browser nor be returned to by one, and it
  // is the only mode that still asks a human to carry a refresh token by hand.
  const mode: ConnectionMode =
    status.activeFlow === "env" ? "env" : (status.connectMode ?? "manual");
  return {
    connected: status.configured,
    flowLabel: status.activeFlow ? FLOW_LABEL[status.activeFlow] : null,
    mode,
    editable: mode !== "env",
    eligibilityLabel: LIVE_ELIGIBILITY_GLOSSARY[status.liveEligibility.mode].label,
  };
}
