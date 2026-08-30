// @ts-check
import { describe, it, expect, vi } from "vitest";
import {
  resolvePort,
  resolveDataDir,
  shouldOpenExternally,
  trayTemplate,
  pickBundledClient,
  installPromptOptions,
} from "./host.mjs";

describe("resolvePort", () => {
  it("defaults to 8080 with no PORT set", () => {
    expect(resolvePort({})).toBe(8080);
  });

  it("takes a numeric PORT", () => {
    expect(resolvePort({ PORT: "9000" })).toBe(9000);
  });

  it("falls back rather than listening on a garbage port", () => {
    expect(resolvePort({ PORT: "not-a-port" })).toBe(8080);
    expect(resolvePort({ PORT: "" })).toBe(8080);
  });

  it("falls back on 0 — an ephemeral port would leave the window pointed at the wrong URL", () => {
    // The window and tray both build their URL from this number before the server listens, so
    // "let the OS pick" cannot work here even though the server itself would accept it.
    expect(resolvePort({ PORT: "0" })).toBe(8080);
  });
});

describe("resolveDataDir", () => {
  it("puts the store under the OS per-user app data dir", () => {
    // Program Files is read-only for standard users, so the store must never sit next to the exe.
    expect(resolveDataDir({}, "/users/me/AppData/YT Companion")).toBe(
      "/users/me/AppData/YT Companion/data",
    );
  });

  it("leaves an explicit DATA_DIR alone", () => {
    expect(resolveDataDir({ DATA_DIR: "/srv/state" }, "/users/me/AppData")).toBe("/srv/state");
  });
});

describe("shouldOpenExternally", () => {
  const appUrl = "http://localhost:8080";

  it("keeps the dashboard's own pages in the window", () => {
    expect(shouldOpenExternally(appUrl, appUrl)).toBe(false);
    expect(shouldOpenExternally(`${appUrl}/settings`, appUrl)).toBe(false);
  });

  it("sends offsite links to the system browser", () => {
    // Google blocks embedded webviews, and a stray Electron window has no address bar.
    expect(shouldOpenExternally("https://youtube.com/watch?v=x", appUrl)).toBe(true);
  });

  it("is not fooled by a host that merely starts with the app's URL", () => {
    // A prefix test would keep this inside the app window, chromeless and trusted.
    expect(shouldOpenExternally("http://localhost:8080.example.test/x", appUrl)).toBe(true);
  });

  it("treats a different local port as offsite", () => {
    expect(shouldOpenExternally("http://localhost:9999/", appUrl)).toBe(true);
  });

  it("treats an unparseable url as offsite rather than loading it", () => {
    expect(shouldOpenExternally("javascript:alert(1)", appUrl)).toBe(true);
    expect(shouldOpenExternally("", appUrl)).toBe(true);
  });
});

/** The actions the tray menu is wired to, all spied. */
function actions() {
  return {
    onInstall: vi.fn(),
    onCheck: vi.fn(),
    onShow: vi.fn(),
    onOpenInBrowser: vi.fn(),
    onQuit: vi.fn(),
  };
}

/**
 * Labels only — the shape assertions read better than deep-matching menu objects.
 * @param {import("./host.mjs").TrayMenuItem[]} template
 */
const labels = (template) => template.map((item) => item.label ?? `<${item.type}>`);

describe("trayTemplate", () => {
  it("always offers dashboard, browser and quit", () => {
    const a = actions();
    const template = trayTemplate(undefined, a);
    expect(labels(template)).toEqual([
      "Open dashboard",
      "Open in browser",
      "<separator>",
      "Quit",
    ]);
  });

  it("shows no update entry before the controller exists or when updates are unsupported", () => {
    // A portable exe has no installer to hand off to — offering "Check for updates" there would
    // only ever report a check that cannot lead anywhere.
    expect(labels(trayTemplate(undefined, actions()))).not.toContain("Check for updates");
    expect(labels(trayTemplate({ status: "unsupported" }, actions()))).not.toContain(
      "Check for updates",
    );
  });

  it("offers a re-check when the launch check found nothing or failed", () => {
    /** @type {import("./updater.mjs").UpdateStatus[]} */
    const inconclusive = ["idle", "error"];
    for (const status of inconclusive) {
      const a = actions();
      const template = trayTemplate({ status }, a);
      expect(labels(template)[0]).toBe("Check for updates");
      template[0].click?.();
      expect(a.onCheck).toHaveBeenCalledTimes(1);
    }
  });

  it("reports a check in flight without offering a second one", () => {
    const template = trayTemplate({ status: "checking" }, actions());
    expect(template[0]).toMatchObject({ label: "Checking for updates…", enabled: false });
  });

  it("shows download progress, and the version even before a percent arrives", () => {
    const withPct = trayTemplate({ status: "downloading", version: "2.5.0", percent: 42 }, actions());
    expect(withPct[0]).toMatchObject({
      label: "Downloading update (v2.5.0)… 42%",
      enabled: false,
    });
    // electron-updater emits `download-progress` only after the first chunk.
    const noPct = trayTemplate({ status: "downloading", version: "2.5.0" }, actions());
    expect(noPct[0].label).toBe("Downloading update (v2.5.0)…");
  });

  it("offers the install only once the update is on disk", () => {
    const a = actions();
    const template = trayTemplate({ status: "downloaded", version: "2.5.0" }, a);
    expect(template[0].label).toBe("Install update (v2.5.0) & restart");
    expect(template[0].enabled).not.toBe(false);
    template[0].click?.();
    expect(a.onInstall).toHaveBeenCalledTimes(1);
  });

  it("separates the update entry from the standing menu", () => {
    const template = trayTemplate({ status: "downloaded", version: "2.5.0" }, actions());
    expect(template[1]).toMatchObject({ type: "separator" });
    expect(labels(template).slice(2)).toEqual([
      "Open dashboard",
      "Open in browser",
      "<separator>",
      "Quit",
    ]);
  });

  it("wires the standing entries to their handlers", () => {
    const a = actions();
    const template = trayTemplate(undefined, a);
    for (const item of template) item.click?.();
    expect(a.onShow).toHaveBeenCalledTimes(1);
    expect(a.onOpenInBrowser).toHaveBeenCalledTimes(1);
    expect(a.onQuit).toHaveBeenCalledTimes(1);
  });
});

describe("pickBundledClient", () => {
  it("returns the build-time client", () => {
    expect(
      pickBundledClient({
        HAS_BUNDLED_CLIENT: true,
        BUNDLED_CLIENT_ID: "id",
        BUNDLED_CLIENT_SECRET: "secret",
      }),
    ).toEqual({ clientId: "id", clientSecret: "secret" });
  });

  it("declines a placeholder file so the build offers no one-click flow instead of a broken one", () => {
    // gen-oauth-config.mjs writes the module either way; the flag is what says it carries a client.
    expect(
      pickBundledClient({
        HAS_BUNDLED_CLIENT: false,
        BUNDLED_CLIENT_ID: "",
        BUNDLED_CLIENT_SECRET: "",
      }),
    ).toBeUndefined();
  });

  it("declines a half-filled client", () => {
    expect(
      pickBundledClient({ HAS_BUNDLED_CLIENT: true, BUNDLED_CLIENT_ID: "id" }),
    ).toBeUndefined();
    expect(
      pickBundledClient({ HAS_BUNDLED_CLIENT: true, BUNDLED_CLIENT_SECRET: "secret" }),
    ).toBeUndefined();
  });

  it("declines nothing at all", () => {
    expect(pickBundledClient(undefined)).toBeUndefined();
    expect(pickBundledClient({})).toBeUndefined();
  });
});

describe("installPromptOptions", () => {
  it("defaults to not installing, on both the default and the cancel path", () => {
    const options = installPromptOptions("2.5.0");
    expect(options.buttons[0]).toBe("Install & restart");
    // Enter and Escape must both mean "Not now": a restart mid-stream is the one thing the
    // updater exists to avoid, so no reflex keypress may trigger it.
    expect(options.defaultId).toBe(1);
    expect(options.cancelId).toBe(1);
  });

  it("names the version being installed and warns about the disconnect", () => {
    const options = installPromptOptions("2.5.0");
    expect(options.message).toContain("2.5.0");
    expect(options.detail).toMatch(/mid-stream/);
  });
});
