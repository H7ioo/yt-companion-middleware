import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../api.js";
import { canAdminister, expiryNotice, showLogin } from "./session.js";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 0, 1);

const info = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  authRequired: true,
  authenticated: true,
  account: { id: "a1", name: "operator", role: "admin" },
  expiringSoon: false,
  absoluteExpiresAt: new Date(now + 90 * DAY).toISOString(),
  ...over,
});

describe("showLogin", () => {
  it("gates the dashboard when a deployment authenticates and nobody is signed in", () => {
    expect(showLogin(info({ authenticated: false, account: null }))).toBe(true);
  });

  it("never gates a deployment that has no accounts", () => {
    // The desktop and LAN installs: a login screen here would lock out an operator who has no
    // credential to type, and there is nothing behind it to protect.
    expect(showLogin(info({ authRequired: false, authenticated: false, account: null }))).toBe(false);
  });

  it("does not gate a signed-in browser", () => {
    expect(showLogin(info())).toBe(false);
  });

  it("shows nothing until the state has actually loaded", () => {
    expect(showLogin(null)).toBe(false);
  });
});

describe("canAdminister", () => {
  it("lets an admin see the admin controls", () => {
    expect(canAdminister(info())).toBe(true);
  });

  it("hides them from a user, rather than offering a button that answers 403", () => {
    expect(canAdminister(info({ account: { id: "a2", name: "camera", role: "user" } }))).toBe(false);
  });

  it("shows everything on a deployment with no accounts", () => {
    // The desktop and LAN installs: one operator, no roles, and the connection controls are the
    // only way they have ever set the app up.
    expect(canAdminister(info({ authRequired: false, authenticated: false, account: null }))).toBe(
      true,
    );
  });

  it("shows everything when there is no sign-in state at all", () => {
    // Null is the same answer showLogin gives: /me was unreachable or never asked, which is the
    // desktop case. Hiding the connection controls there would leave an operator no way to set
    // the app up.
    expect(canAdminister(null)).toBe(true);
  });

  it("hides them from a browser that is not signed in to a deployment that authenticates", () => {
    expect(canAdminister(info({ authenticated: false, account: null }))).toBe(false);
  });
});

describe("expiryNotice", () => {
  it("stays quiet on a session nowhere near its cap", () => {
    expect(expiryNotice(info(), now)).toBeNull();
  });

  it("counts the days left once the session is flagged as expiring", () => {
    const soon = info({ expiringSoon: true, absoluteExpiresAt: new Date(now + 3 * DAY).toISOString() });
    expect(expiryNotice(soon, now)).toMatch(/expires in 3 days/);
  });

  it("says tomorrow rather than in 1 days", () => {
    const soon = info({
      expiringSoon: true,
      absoluteExpiresAt: new Date(now + 1.5 * DAY).toISOString(),
    });
    expect(expiryNotice(soon, now)).toMatch(/expires tomorrow/);
  });

  it("says today on the last day", () => {
    const soon = info({
      expiringSoon: true,
      absoluteExpiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    });
    expect(expiryNotice(soon, now)).toMatch(/expires today/);
  });

  it("says nothing to a signed-out browser", () => {
    expect(expiryNotice(info({ authenticated: false, expiringSoon: true }), now)).toBeNull();
    expect(expiryNotice(null, now)).toBeNull();
  });
});
