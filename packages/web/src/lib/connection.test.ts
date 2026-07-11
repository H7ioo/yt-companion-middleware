import { describe, expect, it } from "vitest";
import { describeConnection } from "./connection.js";
import type { SetupStatus } from "../api.js";

const status = (over: Partial<SetupStatus> = {}): SetupStatus => ({
  configured: false,
  hasClientId: false,
  hasClientSecret: false,
  hasRefreshToken: false,
  hasBundledClient: false,
  canConnect: false,
  activeFlow: null,
  redirectUri: "http://localhost:53682/oauth2callback",
  ...over,
});

describe("describeConnection", () => {
  it("is disconnected and editable on an Electron host with no credentials yet", () => {
    const v = describeConnection(status({ canConnect: true, hasBundledClient: true }));
    expect(v.connected).toBe(false);
    expect(v.editable).toBe(true);
    expect(v.flowLabel).toBeNull();
  });

  it("labels the bundled flow when connected through the shipped client", () => {
    const v = describeConnection(
      status({ canConnect: true, configured: true, hasRefreshToken: true, activeFlow: "bundled" }),
    );
    expect(v.connected).toBe(true);
    expect(v.flowLabel).toBe("Bundled Google client");
    expect(v.editable).toBe(true);
  });

  it("labels the override flow when connected through the operator's own client", () => {
    const v = describeConnection(
      status({ canConnect: true, configured: true, hasRefreshToken: true, activeFlow: "override" }),
    );
    expect(v.flowLabel).toBe("Your own Google client");
    expect(v.editable).toBe(true);
  });

  it("is read-only for env/CLI credentials even on an Electron host", () => {
    const v = describeConnection(
      status({ canConnect: true, configured: true, activeFlow: "env" }),
    );
    expect(v.flowLabel).toBe("Environment or CLI");
    expect(v.editable).toBe(false);
  });

  it("is read-only on a headless/Docker host with no browser to drive", () => {
    const v = describeConnection(status({ canConnect: false, configured: true, activeFlow: "env" }));
    expect(v.editable).toBe(false);
  });
});
