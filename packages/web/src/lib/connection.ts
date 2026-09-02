import type { SetupStatus } from "../api.js";

/**
 * How the YouTube connection can be changed from this host.
 *
 * - `in-app`  — the host can drive the system browser (Electron), so consent runs inline.
 * - `manual`  — the credentials are in the app's own store, but there is no browser to drive
 *               (headless/Docker), so they are replaced by pasting a fresh refresh token.
 * - `env`     — supplied out-of-band via env vars or the CLI; the store holds nothing, so
 *               nothing here can change them.
 */
export type ConnectionMode = "in-app" | "manual" | "env";

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
}

const FLOW_LABEL: Record<NonNullable<SetupStatus["activeFlow"]>, string> = {
  bundled: "Bundled Google client",
  override: "Your own Google client",
  env: "Environment or CLI",
};

export function describeConnection(status: SetupStatus): ConnectionView {
  // Env/CLI credentials live outside the app's store, so the in-app controls can't touch them.
  // Everything else is store-backed and *is* the app's to change — the host only decides how:
  // with a browser to drive, consent runs inline; without one, a token is pasted.
  const mode: ConnectionMode =
    status.activeFlow === "env" ? "env" : status.canConnect ? "in-app" : "manual";
  return {
    connected: status.configured,
    flowLabel: status.activeFlow ? FLOW_LABEL[status.activeFlow] : null,
    mode,
    editable: mode !== "env",
  };
}
