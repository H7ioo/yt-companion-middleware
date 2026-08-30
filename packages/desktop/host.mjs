// @ts-check
// The parts of the desktop shell that are decisions rather than Electron calls.
//
// main.mjs cannot be imported under test: at module scope it takes the single-instance lock,
// reads app.getPath() and registers app lifecycle handlers, all of which need a real Electron
// runtime. So the branching lives here instead — the tray menu's update states, which links leave
// the window, where the store is written, and what the install prompt says — and main.mjs is left
// as the wiring that hands these results to Electron. Same reason updater.mjs takes an injected
// autoUpdater: the policy is testable, the host is not.

import path from "node:path";

/**
 * The menu item shape Electron's Menu.buildFromTemplate accepts, narrowed to what this menu uses.
 * Declared here rather than aliasing MenuItemConstructorOptions so the tests can invoke `click`
 * without conjuring the three Electron arguments the real signature takes.
 * @typedef {{ label?: string, type?: "separator", enabled?: boolean, click?: () => void }} TrayMenuItem
 * @typedef {import("./updater.mjs").UpdateState} UpdateState
 * @typedef {{
 *   onInstall: () => void,
 *   onCheck: () => void,
 *   onShow: () => void,
 *   onOpenInBrowser: () => void,
 *   onQuit: () => void,
 * }} TrayActions
 */

/**
 * The port the embedded server listens on and the window points at. Anything unparseable — and 0,
 * which would hand the OS an ephemeral port the already-built window URL could not name — falls
 * back to the default.
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
export function resolvePort(env) {
  return Number.parseInt(env.PORT ?? "", 10) || 8080;
}

/**
 * Where the JSON store lives. Defaults under the OS per-user app data dir rather than next to the
 * executable, because Program Files is read-only for standard users.
 * @param {Record<string, string | undefined>} env
 * @param {string} userDataPath
 * @returns {string}
 */
export function resolveDataDir(env, userDataPath) {
  return env.DATA_DIR ?? path.join(userDataPath, "data");
}

/**
 * Whether a link the page tried to open belongs in the system browser instead of an Electron
 * window. Anything that is not the dashboard's own origin does: Google blocks embedded webviews
 * for consent, and a stray chromeless window has no address bar to check.
 *
 * Origin, not prefix — `http://localhost:8080.example.test` starts with the app URL but is a
 * different host entirely, and keeping it inside the window would present it as the app.
 * @param {string} url
 * @param {string} appUrl
 * @returns {boolean}
 */
export function shouldOpenExternally(url, appUrl) {
  try {
    return new URL(url).origin !== new URL(appUrl).origin;
  } catch {
    // Unparseable (or a javascript: url, whose origin is "null"): never load it in the window.
    return true;
  }
}

/**
 * The tray context menu. The tray is the update surface: a downloaded update shows up as an entry
 * the operator clicks when they are between streams, and nothing here ever restarts on its own.
 * @param {UpdateState | undefined} state
 * @param {TrayActions} actions
 * @returns {TrayMenuItem[]}
 */
export function trayTemplate(state, actions) {
  /** @type {TrayMenuItem[]} */
  const updateItems = [];
  if (state?.status === "downloading") {
    const pct = typeof state.percent === "number" ? ` ${state.percent}%` : "";
    updateItems.push({ label: `Downloading update (v${state.version})…${pct}`, enabled: false });
  } else if (state?.status === "downloaded") {
    updateItems.push({
      label: `Install update (v${state.version}) & restart`,
      click: actions.onInstall,
    });
  } else if (state?.status === "checking") {
    updateItems.push({ label: "Checking for updates…", enabled: false });
  } else if (state && state.status !== "unsupported") {
    // idle or error: the launch check found nothing (or failed) — let the operator re-check.
    updateItems.push({ label: "Check for updates", click: actions.onCheck });
  }
  if (updateItems.length > 0) updateItems.push({ type: "separator" });

  return [
    ...updateItems,
    { label: "Open dashboard", click: actions.onShow },
    { label: "Open in browser", click: actions.onOpenInBrowser },
    { type: "separator" },
    { label: "Quit", click: actions.onQuit },
  ];
}

/**
 * Reads the build-time bundled OAuth client out of the generated module. Returns undefined for a
 * placeholder or half-filled file (local dev / override-only builds), so the app simply offers no
 * one-click flow rather than starting a consent flow that cannot complete.
 * @param {{ HAS_BUNDLED_CLIENT?: boolean, BUNDLED_CLIENT_ID?: string, BUNDLED_CLIENT_SECRET?: string } | undefined} mod
 * @returns {{ clientId: string, clientSecret: string } | undefined}
 */
export function pickBundledClient(mod) {
  if (mod?.HAS_BUNDLED_CLIENT && mod.BUNDLED_CLIENT_ID && mod.BUNDLED_CLIENT_SECRET) {
    return { clientId: mod.BUNDLED_CLIENT_ID, clientSecret: mod.BUNDLED_CLIENT_SECRET };
  }
  return undefined;
}

/**
 * The confirmation shown before an update is installed. Both defaultId and cancelId point at
 * "Not now": installing restarts the app, and a restart mid-stream is the one thing this updater
 * exists to avoid, so no reflex Enter or Escape may trigger it.
 * @param {string | undefined} version
 * @returns {import("electron").MessageBoxOptions & { buttons: string[] }}
 */
export function installPromptOptions(version) {
  return {
    type: "question",
    buttons: ["Install & restart", "Not now"],
    defaultId: 1,
    cancelId: 1,
    title: "Install update",
    message: `Install YT Companion v${version} now?`,
    detail:
      "The app will close and restart. Companion will lose its connection for a few seconds — " +
      "do not do this mid-stream.",
  };
}

/** The dialog index that means "go ahead" — paired with installPromptOptions' button order. */
export const INSTALL_CONFIRMED = 0;
