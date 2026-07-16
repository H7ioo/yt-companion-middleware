import { describe, it, expect } from "vitest";
import type { AppInfo } from "../api.js";
import {
  shouldAnnounce,
  readLastSeen,
  markSeen,
  splitScope,
  describeUpdate,
  hasUpdateNotes,
} from "./whatsNew.js";

describe("shouldAnnounce", () => {
  it("announces after a version change — the first launch on a new build", () => {
    expect(shouldAnnounce("2.2.0", "2.1.0")).toBe(true);
  });

  it("stays quiet on a re-launch of the same version", () => {
    expect(shouldAnnounce("2.2.0", "2.2.0")).toBe(false);
  });

  it("stays quiet on a fresh install — nothing changed for someone who never ran the old build", () => {
    expect(shouldAnnounce("2.2.0", null)).toBe(false);
  });
});

describe("readLastSeen / markSeen", () => {
  it("round-trips the acknowledged version", () => {
    const map = new Map<string, string>();
    const store = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    expect(readLastSeen(store)).toBeNull();
    markSeen("2.2.0", store);
    expect(readLastSeen(store)).toBe("2.2.0");
  });

  it("survives storage being blocked rather than taking the dashboard down with it", () => {
    const blocked = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readLastSeen(blocked)).toBeNull();
    expect(() => markSeen("2.2.0", blocked)).not.toThrow();
  });
});

describe("splitScope", () => {
  it("pulls the scope out of the changelog's **scope:** convention", () => {
    expect(splitScope("**desktop:** streaming-safe auto-update")).toEqual({
      scope: "desktop",
      text: "streaming-safe auto-update",
    });
  });

  it("leaves a scopeless item alone", () => {
    expect(splitScope("in-app What's New panel")).toEqual({
      scope: null,
      text: "in-app What's New panel",
    });
  });
});

describe("describeUpdate", () => {
  it("says nothing at all on a host with no updater", () => {
    expect(describeUpdate({ status: "unsupported" })).toBeNull();
  });

  it("says nothing while checking, when up to date, or when the check failed", () => {
    expect(describeUpdate({ status: "checking" })).toBeNull();
    expect(describeUpdate({ status: "idle" })).toBeNull();
    // A failed check is logged, never shown: it is not the operator's problem mid-stream.
    expect(describeUpdate({ status: "error", error: "ENOTFOUND" })).toBeNull();
  });

  it("shows a non-installable notice while downloading", () => {
    const banner = describeUpdate({ status: "downloading", version: "2.2.0" });
    expect(banner?.title).toBe("Update v2.2.0 downloading");
    expect(banner?.installable).toBe(false);
    expect(banner?.retryable).toBe(false);
  });

  it("shows download progress once the updater reports it", () => {
    const banner = describeUpdate({ status: "downloading", version: "2.2.0", percent: 42 });
    expect(banner?.note).toContain("(42%)");
    // Before the first progress event there is no percent — the note must not show a blank "()".
    expect(describeUpdate({ status: "downloading", version: "2.2.0" })?.note).not.toContain("(");
  });

  it("surfaces a failed download with a retry — the operator was already promised this update", () => {
    const banner = describeUpdate({ status: "error", error: "net::ERR_CONNECTION_RESET", version: "2.2.0" });
    expect(banner?.title).toBe("Update v2.2.0 couldn't download");
    expect(banner?.installable).toBe(false);
    expect(banner?.retryable).toBe(true);
  });

  it("offers the install once downloaded, and warns about the restart", () => {
    const banner = describeUpdate({ status: "downloaded", version: "2.2.0" });
    expect(banner?.title).toBe("Update v2.2.0 ready to install");
    expect(banner?.installable).toBe(true);
    expect(banner?.note).toMatch(/off air/i);
  });
});

describe("hasUpdateNotes (banner 'What's in it' affordance, PRD-10 §3)", () => {
  const info = (updateNotes: AppInfo["updateNotes"]): Pick<AppInfo, "updateNotes"> => ({ updateNotes });

  it("offers the affordance when the offered version carries feed notes", () => {
    expect(hasUpdateNotes(info("Streaming-safe auto-update."))).toBe(true);
  });

  it("hides the affordance when there are no notes to show", () => {
    expect(hasUpdateNotes(info(null))).toBe(false);
    expect(hasUpdateNotes(info("   "))).toBe(false);
  });
});
