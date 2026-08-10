// @ts-check
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  isUpdateSupported,
  createUpdateController,
  normalizeNotes,
  resolveChannel,
} from "./updater.mjs";

/** Minimal stand-in for electron-updater's autoUpdater (an EventEmitter + the calls we make). */
function fakeUpdater() {
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    // electron-updater infers this from the running version in its constructor; the controller
    // overwrites it explicitly, so start it wrong to prove the override happens.
    allowPrerelease: true,
    logger: null,
    checkForUpdates: vi.fn(async () => ({})),
    quitAndInstall: vi.fn(),
  });
  return updater;
}

function controller(overrides = {}) {
  const updater = fakeUpdater();
  const log = vi.fn();
  const onState = vi.fn();
  const ctl = createUpdateController({
    updater,
    log,
    onState,
    supported: true,
    currentVersion: "2.4.0",
    ...overrides,
  });
  return { updater, log, onState, ctl };
}

describe("isUpdateSupported", () => {
  it("supports the packaged Windows installer build", () => {
    expect(isUpdateSupported({ isPackaged: true, platform: "win32", env: {} })).toBe(true);
  });

  it("skips the dev run — there is no update feed for an unpackaged app", () => {
    expect(isUpdateSupported({ isPackaged: false, platform: "win32", env: {} })).toBe(false);
  });

  it("skips the portable exe — it cannot self-install (PRD-09 §A.0)", () => {
    const env = { PORTABLE_EXECUTABLE_DIR: "D:\\sticks" };
    expect(isUpdateSupported({ isPackaged: true, platform: "win32", env })).toBe(false);
  });

  it("skips non-Windows builds — only the NSIS target publishes a feed", () => {
    expect(isUpdateSupported({ isPackaged: true, platform: "linux", env: {} })).toBe(false);
  });
});

describe("resolveChannel", () => {
  it("keeps a stable build on the stable channel", () => {
    expect(resolveChannel("2.4.0")).toEqual({ allowPrerelease: false, channel: null, frozen: false });
  });

  it("puts a beta build on the beta channel, which stable releases can reach", () => {
    expect(resolveChannel("2.4.1-beta.20260810.3")).toEqual({
      allowPrerelease: true,
      channel: "beta",
      frozen: false,
    });
    expect(resolveChannel("2.4.1-alpha.1").frozen).toBe(false);
  });

  // The bug this whole change exists for: electron-updater's feed walk only lets alpha/beta match
  // a stable entry, so any other identifier is a dead end no stable release can ever reach.
  it("flags a custom pre-release channel as frozen out of the stable channel", () => {
    expect(resolveChannel("2.3.1-nightly.20260716.9")).toEqual({
      allowPrerelease: true,
      channel: "nightly",
      frozen: true,
    });
    expect(resolveChannel("2.3.1-rc.1").frozen).toBe(true);
  });

  it("treats an unparseable version as stable rather than guessing", () => {
    expect(resolveChannel(undefined).allowPrerelease).toBe(false);
    expect(resolveChannel("").allowPrerelease).toBe(false);
  });
});

describe("normalizeNotes", () => {
  it("passes a plain string through, trimmed", () => {
    expect(normalizeNotes("  Fixed a bug.  ")).toBe("Fixed a bug.");
  });

  it("joins an array of {note} objects into one string", () => {
    const notes = [
      { version: "2.2.0", note: "Added auto-update." },
      { version: "2.1.0", note: "Fixed the health probe." },
    ];
    expect(normalizeNotes(notes)).toBe("Added auto-update.\n\nFixed the health probe.");
  });

  it("strips trivial HTML tags GitHub may wrap notes in", () => {
    expect(normalizeNotes("<p>Fixed a bug.</p>")).toBe("Fixed a bug.");
  });

  it("omits (undefined) empty, null, or unusable notes", () => {
    expect(normalizeNotes(null)).toBeUndefined();
    expect(normalizeNotes(undefined)).toBeUndefined();
    expect(normalizeNotes("   ")).toBeUndefined();
    expect(normalizeNotes(42)).toBeUndefined();
  });
});

describe("createUpdateController", () => {
  it("checks on launch and downloads in the background, but never installs on quit", async () => {
    const { updater, ctl } = controller();
    await ctl.start();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(ctl.getState().status).toBe("checking");
  });

  it("pins the channel explicitly instead of inheriting electron-updater's inference", async () => {
    const stable = controller({ currentVersion: "2.4.0" });
    await stable.ctl.start();
    expect(stable.updater.allowPrerelease).toBe(false);

    const beta = controller({ currentVersion: "2.4.1-beta.20260810.3" });
    await beta.ctl.start();
    expect(beta.updater.allowPrerelease).toBe(true);
  });

  it("logs an error when the build sits on a channel stable releases cannot reach", async () => {
    const { ctl, log } = controller({ currentVersion: "2.3.1-nightly.20260716.9" });
    await ctl.start();
    expect(log).toHaveBeenCalledWith("error", expect.stringContaining("can never reach"));
  });

  it("does not check at all on an unsupported build", async () => {
    const { updater, ctl } = controller({ supported: false });
    await ctl.start();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(ctl.getState().status).toBe("unsupported");
  });

  it("tracks the offered version through available -> downloaded", async () => {
    const { updater, ctl, onState } = controller();
    await ctl.start();

    updater.emit("update-available", { version: "2.1.0" });
    expect(ctl.getState()).toMatchObject({ status: "downloading", version: "2.1.0" });

    updater.emit("update-downloaded", { version: "2.1.0" });
    expect(ctl.getState()).toMatchObject({ status: "downloaded", version: "2.1.0" });
    expect(onState).toHaveBeenCalled();
  });

  it("threads the feed's release notes onto the state (PRD-10 §3)", async () => {
    const { updater, ctl } = controller();
    await ctl.start();

    updater.emit("update-available", { version: "2.1.0", releaseNotes: "Fixes the health probe." });
    expect(ctl.getState()).toMatchObject({
      status: "downloading",
      version: "2.1.0",
      notes: "Fixes the health probe.",
    });

    // A structured feed (array of per-release {note}) is coerced to one plain string.
    updater.emit("update-downloaded", {
      version: "2.1.0",
      releaseNotes: [{ version: "2.1.0", note: "<p>Fixes the health probe.</p>" }],
    });
    expect(ctl.getState()).toMatchObject({
      status: "downloaded",
      notes: "Fixes the health probe.",
    });
  });

  it("omits notes when the feed carries none", async () => {
    const { updater, ctl } = controller();
    await ctl.start();
    updater.emit("update-available", { version: "2.1.0" });
    expect(ctl.getState().notes).toBeUndefined();
  });

  it("tracks download progress in whole percents, without spamming state changes", async () => {
    const { updater, ctl, onState } = controller();
    await ctl.start();
    updater.emit("update-available", { version: "2.2.1" });

    updater.emit("download-progress", { percent: 12.7 });
    expect(ctl.getState()).toMatchObject({ status: "downloading", version: "2.2.1", percent: 12 });

    // Progress fires many times a second; the same whole percent must not re-fire onState.
    const calls = onState.mock.calls.length;
    updater.emit("download-progress", { percent: 12.9 });
    expect(onState).toHaveBeenCalledTimes(calls);

    updater.emit("download-progress", { percent: 13.1 });
    expect(ctl.getState().percent).toBe(13);
  });

  it("ignores a stray progress event once the download is no longer running", async () => {
    const { updater, ctl } = controller();
    await ctl.start();
    updater.emit("update-available", { version: "2.2.1" });
    updater.emit("error", new Error("net::ERR_CONNECTION_RESET"));

    updater.emit("download-progress", { percent: 50 });
    expect(ctl.getState().status).toBe("error");
  });

  it("keeps the offered version on a failed download, so the dashboard can offer a retry", async () => {
    const { updater, ctl, log } = controller();
    await ctl.start();
    updater.emit("update-available", { version: "2.2.1", releaseNotes: "Fixes." });
    updater.emit("error", new Error("net::ERR_CONNECTION_RESET"));

    expect(ctl.getState()).toMatchObject({
      status: "error",
      error: "net::ERR_CONNECTION_RESET",
      version: "2.2.1",
      notes: "Fixes.",
    });
    expect(log).toHaveBeenCalledWith("error", expect.stringContaining("download failed"));

    // And the error state stays re-checkable — that IS the retry path.
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit("update-available", { version: "2.2.1" });
      return {};
    });
    expect((await ctl.check()).state.status).toBe("downloading");
  });

  // Without this the banner (and its Retry button) vanishes mid-retry and stays gone if the retry
  // also fails, because a versionless error state gives the dashboard nothing to render.
  it("holds the offered version across a retry that fails again", async () => {
    const { updater, ctl } = controller();
    await ctl.start();
    updater.emit("update-available", { version: "2.2.1", releaseNotes: "Fixes." });
    updater.emit("error", new Error("net::ERR_CONNECTION_RESET"));

    updater.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
    const { state } = await ctl.check();
    expect(state).toMatchObject({ status: "error", error: "offline", version: "2.2.1", notes: "Fixes." });
  });

  it("reports checked:false when the request was a no-op, so the UI cannot claim a result", async () => {
    const { updater, ctl } = controller();
    await ctl.start(); // leaves status "checking" — a check is already in flight
    expect(await ctl.check()).toMatchObject({ checked: false });

    updater.emit("update-not-available", {});
    expect(await ctl.check()).toMatchObject({ checked: true });

    const unsupported = controller({ supported: false });
    expect(await unsupported.ctl.check()).toMatchObject({ checked: false });
  });

  it("goes back to idle when the running version is current", async () => {
    const { updater, ctl } = controller();
    await ctl.start();
    updater.emit("update-not-available", { version: "2.0.0" });
    expect(ctl.getState().status).toBe("idle");
  });

  it("re-checks on request from idle, and reports the settled state", async () => {
    const { updater, ctl } = controller();
    await ctl.start();
    updater.emit("update-not-available", {});
    expect(ctl.getState().status).toBe("idle");

    // A release published after the launch check: the manual check must find it.
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit("update-available", { version: "2.2.1" });
      return {};
    });
    const { state, checked } = await ctl.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(checked).toBe(true);
    expect(state).toMatchObject({ status: "downloading", version: "2.2.1" });
  });

  it("re-checks after a failed check — an offline launch must not disable the button", async () => {
    const { updater, ctl } = controller();
    updater.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
    await ctl.start();
    expect(ctl.getState().status).toBe("error");

    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit("update-not-available", {});
      return {};
    });
    const { state } = await ctl.check();
    expect(state.status).toBe("idle");
  });

  it("does not re-check while downloading, once downloaded, or on unsupported builds", async () => {
    const { updater, ctl } = controller();
    await ctl.start();
    updater.emit("update-available", { version: "2.2.1" });
    expect((await ctl.check()).state.status).toBe("downloading");
    updater.emit("update-downloaded", { version: "2.2.1" });
    expect((await ctl.check()).state.status).toBe("downloaded");
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1); // launch check only

    const unsupported = controller({ supported: false });
    expect((await unsupported.ctl.check()).state.status).toBe("unsupported");
    expect(unsupported.updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("installs only on explicit user action, and only once downloaded", async () => {
    const { updater, ctl } = controller();
    await ctl.start();

    expect(ctl.installAndRestart()).toBe(false);
    updater.emit("update-available", { version: "2.1.0" });
    expect(ctl.installAndRestart()).toBe(false);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    updater.emit("update-downloaded", { version: "2.1.0" });
    expect(ctl.installAndRestart()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("runs a beforeInstall hook (server shutdown) before quitting", () => {
    /** @type {string[]} */
    const calls = [];
    const beforeInstall = vi.fn(() => calls.push("beforeInstall"));
    const { updater, ctl } = controller({ beforeInstall });
    updater.emit("update-downloaded", { version: "2.1.0" });
    updater.quitAndInstall.mockImplementation(() => calls.push("quitAndInstall"));

    ctl.installAndRestart();
    expect(calls).toEqual(["beforeInstall", "quitAndInstall"]);
  });

  it("logs an updater error and keeps running on the current version", async () => {
    const { updater, ctl, log } = controller();
    await ctl.start();
    updater.emit("error", new Error("ENOTFOUND github.com"));

    expect(ctl.getState()).toMatchObject({ status: "error", error: "ENOTFOUND github.com" });
    expect(log).toHaveBeenCalledWith("error", expect.stringContaining("ENOTFOUND github.com"));
  });

  it("logs — and does not throw — when the launch check itself rejects", async () => {
    const { updater, ctl, log } = controller();
    updater.checkForUpdates.mockRejectedValue(new Error("offline"));

    await expect(ctl.start()).resolves.toBeUndefined();
    expect(ctl.getState()).toMatchObject({ status: "error", error: "offline" });
    expect(log).toHaveBeenCalledWith("error", expect.stringContaining("offline"));
  });
});
