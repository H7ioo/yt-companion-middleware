// @ts-check
// Electron main process for the YT Companion desktop build.
//
// It runs the exact same middleware server the CLI/Docker build runs — just in-process — and
// wraps the dashboard in a native window with a tray icon, so operators can launch the whole
// thing with a double-click instead of a Docker command. There is no second Node runtime and
// no bundled browser tab: the server listens on localhost and the window points at it.

import { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

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
  tray.setContextMenu(
    Menu.buildFromTemplate([
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
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
}

async function startEmbeddedServer() {
  // Import the compiled server lazily so a build error surfaces as a dialog, not a silent crash.
  const serverUrl = new URL("../server/dist/server.js", import.meta.url);
  /** @type {{ startServer: () => Promise<ServerHandle> }} */
  const mod = await import(serverUrl.href);
  serverHandle = await mod.startServer();
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
