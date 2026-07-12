// @ts-check
// Electron main process for the YT Companion desktop build.
//
// It runs the exact same middleware server the CLI/Docker build runs — just in-process — and
// wraps the dashboard in a native window with a tray icon, so operators can launch the whole
// thing with a double-click instead of a Docker command. There is no second Node runtime and
// no bundled browser tab: the server listens on localhost and the window points at it.

import { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog } from "electron";
import electronUpdater from "electron-updater";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createUpdateController, isUpdateSupported } from "./updater.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number.parseInt(process.env.PORT ?? "", 10) || 8080;
const APP_URL = `http://localhost:${PORT}`;

// Persist the JSON store and any data under the OS per-user app data dir, not next to the
// executable (Program Files is read-only for standard users). loadConfig() reads DATA_DIR.
process.env.DATA_DIR ??= path.join(app.getPath("userData"), "data");

// Only one instance may own the server port — focus the existing window on a second launch.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/**
 * The running middleware server, exposed by packages/server/dist/server.js#startServer.
 * @typedef {{ close(): Promise<void> }} ServerHandle
 */

/** @type {import("electron").BrowserWindow | null} */
let mainWindow = null;
/** @type {import("electron").Tray | null} */
let tray = null;
/** @type {ServerHandle | null} */
let serverHandle = null;
/** @type {ReturnType<typeof createUpdateController> | null} */
let updates = null;
let quitting = false;

const trayIconPath = path.join(here, "assets", "tray.png");
const windowIconPath = path.join(here, "assets", "icon.png");

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#0e1013", // matches the dashboard rack background — no white flash on load
    title: "YT Companion",
    icon: fileExists(windowIconPath) ? windowIconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  void win.loadURL(APP_URL);

  // Open external links (e.g. the "where do I get these" guide, if pointed offsite) in the
  // system browser rather than a stray Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // Closing the window hides to tray so the server keeps running (Companion stays connected).
  // Real quit goes through the tray menu or Cmd/Ctrl-Q.
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const image = fileExists(trayIconPath)
    ? nativeImage.createFromPath(trayIconPath)
    : nativeImage.createEmpty();
  tray = new Tray(image);
  tray.setToolTip("YT Companion");
  refreshTrayMenu();
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
}

// The tray is the update surface for now: a downloaded update shows up as a menu entry the
// operator clicks when they are between streams. Nothing here ever restarts the app on its own.
// (The in-app banner with release notes lands with issue 040.)
function refreshTrayMenu() {
  if (!tray) return;
  const state = updates?.getState();

  /** @type {import("electron").MenuItemConstructorOptions[]} */
  const updateItems = [];
  if (state?.status === "downloading") {
    updateItems.push({ label: `Downloading update (v${state.version})…`, enabled: false });
  } else if (state?.status === "downloaded") {
    updateItems.push({ label: `Install update (v${state.version}) & restart`, click: installUpdate });
  }
  if (updateItems.length > 0) updateItems.push({ type: "separator" });

  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...updateItems,
      { label: "Open dashboard", click: showWindow },
      { label: "Open in browser", click: () => void shell.openExternal(APP_URL) },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// Explicit operator action only — confirm, because installing restarts the app and a restart
// during a live stream is the one thing this updater exists to avoid.
async function installUpdate() {
  const version = updates?.getState().version;
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Install & restart", "Not now"],
    defaultId: 1,
    cancelId: 1,
    title: "Install update",
    message: `Install YT Companion v${version} now?`,
    detail:
      "The app will close and restart. Companion will lose its connection for a few seconds — " +
      "do not do this mid-stream.",
  });
  if (response === 0) updates?.installAndRestart();
}

function startUpdates() {
  const { autoUpdater } = electronUpdater;
  autoUpdater.logger = null; // we log through logUpdate() below, no electron-log dependency
  updates = createUpdateController({
    updater: autoUpdater,
    supported: isUpdateSupported({
      isPackaged: app.isPackaged,
      platform: process.platform,
      env: process.env,
    }),
    log: (level, message) => logUpdate(level, message),
    onState: refreshTrayMenu,
    // quitAndInstall() quits the app, which runs the will-quit handler that closes the server.
    // Flag the quit as intentional so the window's hide-to-tray guard doesn't swallow it.
    beforeInstall: () => {
      quitting = true;
    },
  });
  void updates.start();
}

/**
 * @param {"info" | "error"} level
 * @param {string} message
 */
function logUpdate(level, message) {
  // Update failures are never fatal — the app keeps running on the current version (PRD-09 §A.1).
  if (level === "error") console.error(`[update] ${message}`);
  else console.log(`[update] ${message}`);
}

async function startEmbeddedServer() {
  // Import the compiled server lazily so a build error surfaces as a dialog, not a silent crash.
  const serverUrl = new URL("../server/dist/server.js", import.meta.url);
  /**
   * @typedef {{ status: string, version?: string, error?: string, notes?: string }} UpdateState
   * @typedef {{
   *   openBrowser?: (url: string) => void,
   *   bundledClient?: { clientId: string, clientSecret: string },
   *   appVersion?: string,
   *   changelogPath?: string,
   *   updates?: { getState: () => UpdateState, installAndRestart: () => boolean },
   * }} StartServerOptions
   * @type {{ startServer: (options?: StartServerOptions) => Promise<ServerHandle> }}
   */
  const mod = await import(serverUrl.href);
  // Give the server the two host capabilities it can't have on its own: opening the real
  // system browser for consent (Google blocks embedded webviews) and the build-time bundled
  // OAuth client. Both power the one-click "Connect YouTube" flow (PRD-03 §2).
  const bundledClient = await loadBundledClient();
  serverHandle = await mod.startServer({
    openBrowser: (url) => void shell.openExternal(url),
    bundledClient,
    // What's New + the update banner are served by the dashboard, so the server needs the two
    // things only the host knows: which version this binary is, and what the updater is doing
    // (PRD-09 §B.2). The updater is read through a getter because it is created after the server.
    appVersion: app.getVersion(),
    changelogPath: path.resolve(here, "..", "..", "CHANGELOG.md"),
    updates: {
      getState: () => updates?.getState() ?? { status: "unsupported" },
      installAndRestart: () => updates?.installAndRestart() ?? false,
    },
  });
}

/**
 * Loads the build-time bundled OAuth client written by scripts/gen-oauth-config.mjs. Returns
 * undefined when the generated file is absent or empty (local dev / override-only builds), so the
 * app simply offers no one-click flow rather than crashing.
 * @returns {Promise<{ clientId: string, clientSecret: string } | undefined>}
 */
async function loadBundledClient() {
  try {
    const mod = await import(new URL("./generated/oauth.mjs", import.meta.url).href);
    if (mod.HAS_BUNDLED_CLIENT && mod.BUNDLED_CLIENT_ID && mod.BUNDLED_CLIENT_SECRET) {
      return { clientId: mod.BUNDLED_CLIENT_ID, clientSecret: mod.BUNDLED_CLIENT_SECRET };
    }
  } catch {
    /* no generated file — override-only build */
  }
  return undefined;
}

app.on("second-instance", showWindow);

app.whenReady().then(async () => {
  try {
    await startEmbeddedServer();
  } catch (err) {
    dialog.showErrorBox(
      "YT Companion failed to start",
      `The background server could not start.\n\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    app.quit();
    return;
  }
  createTray();
  createWindow();
  startUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
});

app.on("before-quit", () => {
  quitting = true;
});

// Keep running when all windows are closed — the tray owns the lifecycle here.
app.on("window-all-closed", () => {
  // Intentionally do not quit: the server should keep serving Companion in the background.
});

app.on("will-quit", async (event) => {
  if (serverHandle) {
    event.preventDefault();
    const handle = serverHandle;
    serverHandle = null;
    try {
      await handle.close();
    } catch {
      /* best-effort shutdown */
    }
    app.exit(0);
  }
});

/**
 * @param {string} p
 * @returns {boolean}
 */
function fileExists(p) {
  // Synchronous check is fine at startup — assets ship with the app.
  return fs.existsSync(p);
}
