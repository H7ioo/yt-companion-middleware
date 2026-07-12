// @ts-check
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { isUpdateSupported, createUpdateController, normalizeNotes } from "./updater.mjs";

/** Minimal stand-in for electron-updater's autoUpdater (an EventEmitter + the calls we make). */
function fakeUpdater() {
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
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
  const ctl = createUpdateController({ updater, log, onState, supported: true, ...overrides });
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

  it("goes back to idle when the running version is current", async () => {
    const { updater, ctl } = controller();
    await ctl.start();
    updater.emit("update-not-available", { version: "2.0.0" });
    expect(ctl.getState().status).toBe("idle");
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
