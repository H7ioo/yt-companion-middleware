// @ts-check
// Streaming-safe auto-update policy (PRD-09 §A.1).
//
// This is a live-streaming tool, so the one thing an updater must never do is restart the app
// mid-stream. The rules encoded here: check GitHub once on launch, download in the background,
// and install ONLY when the operator asks (tray -> "Install update & restart"). autoInstallOnAppQuit
// is off, so even quitting the app never swaps the binary out from under an operator.
//
// The electron-updater `autoUpdater` is injected rather than imported so the policy is testable
// without Electron; main.mjs supplies the real one.

/**
 * The shape here mirrors @app/shared's UpdateState contract (the server route and web banner
 * consume it); keep the two in sync. `notes` carries the offered version's release notes as plain
 * text, taken from the update feed (PRD-10 §3).
 * @typedef {"unsupported" | "checking" | "idle" | "downloading" | "downloaded" | "error"} UpdateStatus
 * @typedef {{ status: UpdateStatus, version?: string, error?: string, notes?: string }} UpdateState
 * @typedef {(level: "info" | "error", message: string) => void} LogFn
 * @typedef {{
 *   autoDownload: boolean,
 *   autoInstallOnAppQuit: boolean,
 *   on(event: string, listener: (payload: any) => void): unknown,
 *   checkForUpdates(): Promise<unknown>,
 *   quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void,
 * }} Updater
 */

/**
 * Which builds can actually take an update. The NSIS installer is the only target with a feed:
 * the portable exe has no installer to hand off to (PRD-09 §A.0), and an unpackaged dev run has
 * no published version to compare against.
 * @param {{ isPackaged: boolean, platform: string, env?: Record<string, string | undefined> }} ctx
 * @returns {boolean}
 */
export function isUpdateSupported({ isPackaged, platform, env = {} }) {
  if (!isPackaged) return false;
  if (platform !== "win32") return false;
  if (env.PORTABLE_EXECUTABLE_DIR) return false; // electron-builder marks the portable exe with this
  return true;
}

/**
 * Coerces electron-updater's `releaseNotes` into plain text for the update banner. The feed can
 * deliver a single string or an array of `{ version, note }` objects (one per intermediate
 * release); either way we want one plain string. HTML tags are stripped when trivially present
 * (GitHub sometimes wraps notes in `<p>`), otherwise the text passes through unchanged. Returns
 * undefined for empty/absent notes so the state simply omits the field (PRD-10 §3).
 * @param {unknown} releaseNotes
 * @returns {string | undefined}
 */
export function normalizeNotes(releaseNotes) {
  if (releaseNotes == null) return undefined;
  let text;
  if (typeof releaseNotes === "string") {
    text = releaseNotes;
  } else if (Array.isArray(releaseNotes)) {
    text = releaseNotes
      .map((n) => (n && typeof n === "object" && "note" in n ? String(n.note ?? "") : String(n ?? "")))
      .join("\n\n");
  } else {
    return undefined;
  }
  const stripped = text.replace(/<[^>]+>/g, "").trim();
  return stripped.length > 0 ? stripped : undefined;
}

/**
 * @param {object} options
 * @param {Updater} options.updater electron-updater's autoUpdater
 * @param {boolean} options.supported result of {@link isUpdateSupported}
 * @param {LogFn} [options.log]
 * @param {(state: UpdateState) => void} [options.onState] called on every state change (tray menu)
 * @param {() => void} [options.beforeInstall] last-chance hook — shut the embedded server down
 */
export function createUpdateController({
  updater,
  supported,
  log = () => {},
  onState = () => {},
  beforeInstall = () => {},
}) {
  /** @type {UpdateState} */
  let state = { status: supported ? "idle" : "unsupported" };

  /** @param {UpdateState} next */
  function setState(next) {
    state = next;
    onState(state);
  }

  /** @param {unknown} err */
  function fail(err) {
    const message = err instanceof Error ? err.message : String(err);
    // Never fatal: an unreachable GitHub just means the operator keeps running this version.
    log("error", `Update check failed: ${message}`);
    setState({ status: "error", error: message });
  }

  updater.on("update-available", (info) => {
    log("info", `Update available (v${info?.version}) — downloading in the background`);
    setState({ status: "downloading", version: info?.version, notes: normalizeNotes(info?.releaseNotes) });
  });

  updater.on("update-not-available", () => {
    log("info", "No update available — running the latest version");
    setState({ status: "idle" });
  });

  updater.on("update-downloaded", (info) => {
    log("info", `Update v${info?.version} downloaded — install on request`);
    setState({ status: "downloaded", version: info?.version, notes: normalizeNotes(info?.releaseNotes) });
  });

  updater.on("error", fail);

  return {
    /** @returns {UpdateState} */
    getState: () => state,

    /** Launch check. Resolves even when the check fails. */
    async start() {
      if (!supported) {
        log("info", "Auto-update is not available for this build (dev, portable, or non-Windows)");
        return;
      }
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = false; // never mid-stream, never behind the operator's back
      setState({ status: "checking" });
      try {
        await updater.checkForUpdates();
      } catch (err) {
        fail(err);
      }
    },

    /**
     * The only path to an install. No-op unless a download has finished.
     * @returns {boolean} whether the install was triggered
     */
    installAndRestart() {
      if (state.status !== "downloaded") return false;
      log("info", `Installing update v${state.version} and restarting`);
      beforeInstall();
      updater.quitAndInstall();
      return true;
    },
  };
}
