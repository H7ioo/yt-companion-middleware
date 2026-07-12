// @ts-check
import { describe, it, expect } from "vitest";
import { checkHealthBody } from "./smoke.mjs";

// The boot itself is the smoke test (it needs a build, so it runs in preflight/CI, not vitest).
// What is unit-testable — and what would silently rot into a check that passes on anything — is
// the shape assertion. These pin it.

describe("checkHealthBody — setup mode", () => {
  const good = {
    status: "setup_required",
    authenticated: false,
    apiEnabled: false,
    setupRequired: true,
    message: "YouTube credentials not configured — open the app to finish setup.",
  };

  it("accepts the setup-mode body the server actually serves", () => {
    expect(checkHealthBody(good, "setup")).toEqual([]);
  });

  it("rejects a configured body served in setup mode — the two must stay distinguishable", () => {
    const problems = checkHealthBody({ ...good, status: "ok", setupRequired: false }, "setup");
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("setup_required");
  });

  it("rejects a missing operator message", () => {
    expect(checkHealthBody({ ...good, message: "" }, "setup")).toContain("message is missing");
  });
});

describe("checkHealthBody — configured mode", () => {
  const good = {
    status: "ok",
    authenticated: true,
    apiEnabled: true,
    message: null,
    quotaUsed: 0,
    quotaLimit: 10000,
    quotaRemaining: 10000,
  };

  it("accepts the credentialed body", () => {
    expect(checkHealthBody(good, "configured")).toEqual([]);
  });

  it("accepts any real health state — a smoke boot may legitimately be degraded or offline", () => {
    for (const status of ["ok", "degraded", "offline", "auth_error"]) {
      expect(checkHealthBody({ ...good, status }, "configured")).toEqual([]);
    }
  });

  it("rejects an unknown health state", () => {
    expect(checkHealthBody({ ...good, status: "fine" }, "configured")[0]).toContain("not one of");
  });

  it("rejects a body missing the quota budget", () => {
    const { quotaLimit, ...missing } = good;
    expect(checkHealthBody(missing, "configured")).toContain("quotaLimit is not a number");
  });

  it("rejects a non-object body", () => {
    expect(checkHealthBody(null, "configured")).toEqual(["body is not a JSON object"]);
  });
});
