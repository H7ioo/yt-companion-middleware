import { describe, expect, it } from "vitest";
import type { AppInfo } from "../api.js";
import { appInfoChanged } from "./appInfo.js";

const info = (over: Partial<AppInfo> = {}): AppInfo => ({
  version: "1.2.3",
  notes: null,
  update: { status: "idle" },
  updateNotes: null,
  ...over,
});

describe("appInfoChanged", () => {
  it("is true on the first payload (no previous)", () => {
    expect(appInfoChanged(null, info())).toBe(true);
  });

  it("is false for an identical-but-fresh object (the idle no-op)", () => {
    expect(appInfoChanged(info(), info())).toBe(false);
  });

  it("detects a running-version change", () => {
    expect(appInfoChanged(info({ version: "1.2.3" }), info({ version: "1.2.4" }))).toBe(true);
  });

  it("detects an updater status change", () => {
    expect(
      appInfoChanged(info({ update: { status: "idle" } }), info({ update: { status: "downloading" } })),
    ).toBe(true);
  });

  it("detects an offered-version change", () => {
    expect(
      appInfoChanged(
        info({ update: { status: "downloaded", version: "1.3.0" } }),
        info({ update: { status: "downloaded", version: "1.3.1" } }),
      ),
    ).toBe(true);
  });

  it("detects a change in the offered release notes", () => {
    expect(
      appInfoChanged(
        info({ update: { status: "downloaded", version: "1.3.0", notes: "old" } }),
        info({ update: { status: "downloaded", version: "1.3.0", notes: "new" } }),
      ),
    ).toBe(true);
  });

  it("ignores fields the dashboard does not key on (running-version notes object identity)", () => {
    // `notes` (the running build's changelog) is stable per version; a new object with the same
    // version must not force a re-render.
    const prev = info({ notes: { version: "1.2.3", date: "2026-07-12", sections: [] } });
    const next = info({ notes: { version: "1.2.3", date: "2026-07-12", sections: [] } });
    expect(appInfoChanged(prev, next)).toBe(false);
  });
});
