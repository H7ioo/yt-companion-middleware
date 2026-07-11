import type { SetupStatus } from "../api.js";

/** Display model for the Settings connection section — pure, so it is testable without a DOM. */
export interface ConnectionView {
  /** Whether the app currently has working YouTube credentials. */
  connected: boolean;
  /** Human label for the active flow, or null when not yet connected. */
  flowLabel: string | null;
  /**
   * Whether the connection can be changed from within the app. True only on an Electron host
   * whose credentials came through the in-app flow; env/CLI and headless boots are read-only and
   * show guidance instead of Connect/Reconnect/Disconnect buttons.
   */
  editable: boolean;
}

const FLOW_LABEL: Record<NonNullable<SetupStatus["activeFlow"]>, string> = {
  bundled: "Bundled Google client",
  override: "Your own Google client",
  env: "Environment or CLI",
};

export function describeConnection(status: SetupStatus): ConnectionView {
  return {
    connected: status.configured,
    flowLabel: status.activeFlow ? FLOW_LABEL[status.activeFlow] : null,
    // Env/CLI credentials live outside the app's store, so the in-app buttons can't touch them.
    editable: status.canConnect && status.activeFlow !== "env",
  };
}
