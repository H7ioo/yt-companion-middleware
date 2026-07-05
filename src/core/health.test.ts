import { describe, expect, it } from "vitest";
import { initialHealth, onFailure, onSuccess } from "./health.js";

describe("health escalation (PRD §5.4)", () => {
  const threshold = 3;

  it("first transient failure -> degraded, not auth_error", () => {
    const s = onFailure(initialHealth(), { isAuthError: false, threshold });
    expect(s.status).toBe("degraded");
    expect(s.consecutiveFailures).toBe(1);
  });

  it("escalates to auth_error only after threshold consecutive failures", () => {
    let s = initialHealth();
    s = onFailure(s, { isAuthError: false, threshold });
    s = onFailure(s, { isAuthError: false, threshold });
    expect(s.status).toBe("degraded");
    s = onFailure(s, { isAuthError: false, threshold });
    expect(s.status).toBe("auth_error");
  });

  it("an auth failure jumps straight to auth_error", () => {
    const s = onFailure(initialHealth(), { isAuthError: true, threshold, message: "revoked" });
    expect(s.status).toBe("auth_error");
    expect(s.message).toBe("revoked");
  });

  it("success clears back to ok and resets the counter", () => {
    let s = onFailure(initialHealth(), { isAuthError: false, threshold });
    s = onSuccess(s);
    expect(s.status).toBe("ok");
    expect(s.consecutiveFailures).toBe(0);
  });
});
