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
 * @typedef {{ status: UpdateStatus, version?: string, error?: string, notes?: string, percent?: number }} UpdateState
 * @typedef {(level: "info" | "error", message: string) => void} LogFn
 * @typedef {{
 *   autoDownload: boolean,
 *   autoInstallOnAppQuit: boolean,
 *   allowPrerelease: boolean,
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
 * Pre-release identifiers electron-updater's GitHubProvider treats as first-class. Its feed walk
 * only accepts a stable entry when the running channel is one of these (`shouldFetchVersion`);
 * any other identifier is a "custom channel" that matches *only* its own kind. That is not a
 * detail we can ignore: a build on a custom channel can never be offered a stable release, so it
 * freezes on that channel forever. This is exactly what happened to the old `-nightly.` tags,
 * which sat on 2.3.1-nightly.9 while stable moved to 2.4.0 (see RELEASING.md → Beta channel).
 */
const PROMOTABLE_CHANNELS = ["alpha", "beta"];

/**
 * The update channel this build follows, derived from its own version.
 *
 * electron-updater infers the same thing implicitly (`allowPrerelease = hasPrereleaseComponents`),
 * but the inference is invisible and was silently wrong for a whole channel, so state it here:
 *
 * - a stable build sets `allowPrerelease = false` and follows `/releases/latest` — stable only;
 * - a `-beta.` build sets `allowPrerelease = true` and walks the feed, taking whichever comes
 *   first, a newer beta or a newer stable. That is how a beta tester is promoted back to stable.
 *
 * We deliberately do NOT set `updater.channel`: leaving it null lets the provider read the channel
 * off our own version (which is what we want), and its setter has the side effect of turning
 * `allowDowngrade` on.
 *
 * @param {string | undefined} version this build's version, e.g. "2.5.1-beta.20260810.3"
 * @returns {{ allowPrerelease: boolean, channel: string | null, frozen: boolean }} `channel` is the
 *   pre-release identifier (null on stable); `frozen` flags a channel stable can never reach.
 */
export function resolveChannel(version) {
  const match = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(String(version ?? ""));
  const channel = match ? match[1] : null;
  return {
    allowPrerelease: channel !== null,
    channel,
    frozen: channel !== null && !PROMOTABLE_CHANNELS.includes(channel),
  };
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
 * @param {string} options.currentVersion this build's version — picks the channel, see {@link resolveChannel}
 * @param {LogFn} [options.log]
 * @param {(state: UpdateState) => void} [options.onState] called on every state change (tray menu)
 * @param {() => void} [options.beforeInstall] last-chance hook — shut the embedded server down
 */
export function createUpdateController({
  updater,
  supported,
  currentVersion,
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
    // A failed download keeps the offered version on the state — that's what lets the dashboard
    // tell "the download broke" (worth a banner + retry) apart from "the check failed" (silent).
    const downloading = state.status === "downloading";
    log("error", `Update ${downloading ? "download" : "check"} failed: ${message}`);
    // The offered version rides through the failure whenever one is known. Without it a failed
    // *retry* of a broken download would land on a versionless error, the dashboard's
    // describeUpdate() would return null, and the banner — Retry button and all — would vanish
    // until the app restarted. A check that failed with nothing on offer has no version anyway.
    setState({ status: "error", error: message, version: state.version, notes: state.notes });
  }

  updater.on("update-available", (info) => {
    log("info", `Update available (v${info?.version}) — downloading in the background`);
    setState({ status: "downloading", version: info?.version, notes: normalizeNotes(info?.releaseNotes) });
  });

  updater.on("download-progress", (progress) => {
    if (state.status !== "downloading") return; // a stray late event must not resurrect a dead download
    const percent = typeof progress?.percent === "number" ? Math.floor(progress.percent) : undefined;
    // Progress fires many times a second; whole percents are all anyone renders, so only a moved
    // percent reaches onState (which rebuilds the tray menu).
    if (percent === state.percent) return;
    setState({ ...state, percent });
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

  async function runCheck() {
    // Carry the offered version across the check for the same reason fail() does: a re-check
    // launched from an error state must not blank the banner while it runs.
    setState({ status: "checking", version: state.version, notes: state.notes });
    try {
      await updater.checkForUpdates();
    } catch (err) {
      fail(err);
    }
  }

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
      // Set the channel explicitly rather than inheriting electron-updater's implicit inference —
      // that inference froze every `-nightly.` install out of the stable channel unnoticed.
      const { allowPrerelease, channel, frozen } = resolveChannel(currentVersion);
      updater.allowPrerelease = allowPrerelease;
      if (frozen) {
        log(
          "error",
          `Version ${currentVersion} is on the "${channel}" pre-release channel, which stable ` +
            `releases can never reach — this build will only ever see other "${channel}" builds. ` +
            `Pre-release tags must use ${PROMOTABLE_CHANNELS.map((c) => `"${c}"`).join(" or ")}.`,
        );
      } else {
        log("info", `Following the ${channel ?? "stable"} update channel`);
      }
      await runCheck();
    },

    /**
     * Operator-triggered re-check (the launch check happens once; a release published after that
     * would otherwise go unseen until restart). No-op while a check or download is already in
     * flight, and when a download is staged — re-checking there could only re-download.
     * Resolves to the state after the check settles, with `checked` reporting whether a check
     * actually ran: the dashboard must not answer a no-op with "you're up to date", which claims
     * a check happened when none did.
     * @returns {Promise<{ state: UpdateState, checked: boolean }>}
     */
    async check() {
      const checked = supported && (state.status === "idle" || state.status === "error");
      if (checked) {
        log("info", "Manual update check requested");
        await runCheck();
      }
      return { state, checked };
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
