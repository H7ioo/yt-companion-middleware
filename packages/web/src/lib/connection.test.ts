import { describe, expect, it } from "vitest";
import { LIVE_ELIGIBILITY_GLOSSARY } from "@app/shared";
import { describeConnection } from "./connection.js";
import type { SetupStatus } from "../api.js";

const status = (over: Partial<SetupStatus> = {}): SetupStatus => ({
  configured: false,
  hasClientId: false,
  hasClientSecret: false,
  hasRefreshToken: false,
  hasBundledClient: false,
  connectMode: null,
  activeFlow: null,
  redirectUri: "http://localhost:53682/oauth2callback",
  liveEligibility: { mode: "unknown", reason: null, message: null, checkedAt: null },
  ...over,
});

describe("describeConnection", () => {
  it("is disconnected and editable on an Electron host with no credentials yet", () => {
    const v = describeConnection(status({ connectMode: "in-app", hasBundledClient: true }));
    expect(v.connected).toBe(false);
    expect(v.editable).toBe(true);
    expect(v.mode).toBe("in-app");
    expect(v.flowLabel).toBeNull();
  });

  it("labels the bundled flow when connected through the shipped client", () => {
    const v = describeConnection(
      status({ connectMode: "in-app", configured: true, hasRefreshToken: true, activeFlow: "bundled" }),
    );
    expect(v.connected).toBe(true);
    expect(v.flowLabel).toBe("Bundled Google client");
    expect(v.editable).toBe(true);
    expect(v.mode).toBe("in-app");
  });

  it("labels the override flow when connected through the operator's own client", () => {
    const v = describeConnection(
      status({ connectMode: "in-app", configured: true, hasRefreshToken: true, activeFlow: "override" }),
    );
    expect(v.flowLabel).toBe("Your own Google client");
    expect(v.editable).toBe(true);
    expect(v.mode).toBe("in-app");
  });

  it("is read-only for env/CLI credentials even on an Electron host", () => {
    const v = describeConnection(
      status({ connectMode: "in-app", configured: true, activeFlow: "env" }),
    );
    expect(v.flowLabel).toBe("Environment or CLI");
    expect(v.editable).toBe(false);
    expect(v.mode).toBe("env");
  });

  it("is read-only on a headless host whose credentials came from env/CLI", () => {
    const v = describeConnection(status({ connectMode: null, configured: true, activeFlow: "env" }));
    expect(v.editable).toBe(false);
    expect(v.mode).toBe("env");
  });

  // The case that stranded a stale token: stored credentials on a host with no browser. They are
  // the app's own — nothing in the environment can replace them — so the paste form must appear.
  it("offers the manual paste form for stored credentials on a headless host", () => {
    const v = describeConnection(
      status({
        connectMode: null,
        configured: true,
        hasClientId: true,
        hasRefreshToken: true,
        activeFlow: "override",
      }),
    );
    expect(v.connected).toBe(true);
    expect(v.mode).toBe("manual");
    expect(v.editable).toBe(true);
    expect(v.flowLabel).toBe("Your own Google client");
  });

  it("offers the manual paste form on a headless host with nothing stored yet", () => {
    const v = describeConnection(status({ connectMode: null }));
    expect(v.mode).toBe("manual");
    expect(v.connected).toBe(false);
  });

  /**
   * The hosted deployment (issue 052). It is headless — no browser for the server to drive — but
   * it is emphatically not `manual`: consent runs in the admin's own browser, so offering them the
   * paste-a-refresh-token form would be sending them back to a CLI script they no longer need.
   */
  it("offers browser sign-in on a hosted host, not the paste form", () => {
    const v = describeConnection(status({ connectMode: "redirect" }));
    expect(v.mode).toBe("redirect");
    expect(v.editable).toBe(true);
    expect(v.connected).toBe(false);
  });

  it("keeps a connected hosted deployment on the redirect flow for reconnects", () => {
    const v = describeConnection(
      status({ connectMode: "redirect", configured: true, hasRefreshToken: true, activeFlow: "override" }),
    );
    expect(v.mode).toBe("redirect");
    expect(v.flowLabel).toBe("Your own Google client");
  });

  it("stays read-only for env/CLI credentials even on a hosted deployment", () => {
    // Nothing in the app's store backs them, so a successful consent here would be overwritten by
    // the environment on the next boot.
    const v = describeConnection(status({ connectMode: "redirect", configured: true, activeFlow: "env" }));
    expect(v.mode).toBe("env");
    expect(v.editable).toBe(false);
  });
});

/**
 * Channel eligibility rides on the connection view (issue 061). It is not a health state and not
 * a connection fault: describeConnection can report Connected while YouTube still refuses to let
 * the channel create anything, and the card has to be able to say both at once.
 */
describe("describeConnection and channel eligibility", () => {
  it("names riding mode from the glossary", () => {
    const view = describeConnection(
      status({
        configured: true,
        activeFlow: "bundled",
        liveEligibility: {
          mode: "riding",
          reason: "livePermissionBlocked",
          message: "no",
          checkedAt: "2026-09-03T10:00:00.000Z",
        },
      }),
    );
    expect(view.connected).toBe(true);
    expect(view.eligibilityLabel).toBe(LIVE_ELIGIBILITY_GLOSSARY.riding.label);
  });

  it("names the unknown mode rather than claiming either answer", () => {
    expect(describeConnection(status()).eligibilityLabel).toBe(
      LIVE_ELIGIBILITY_GLOSSARY.unknown.label,
    );
  });
});
