import { describe, expect, it } from "vitest";
import { initialHealth, onFailure, onSuccess } from "./health.js";

describe("health escalation (PRD-06 §1)", () => {
  const threshold = 3;

  it("first transient failure -> degraded, not auth_error", () => {
    const s = onFailure(initialHealth(), { kind: "transient", threshold });
    expect(s.status).toBe("degraded");
    expect(s.consecutiveFailures).toBe(1);
  });

  it("an unclassified transient never escalates past degraded", () => {
    let s = initialHealth();
    for (let i = 0; i < threshold + 2; i++) {
      s = onFailure(s, { kind: "transient", threshold });
    }
    expect(s.status).toBe("degraded");
  });

  it("a network failure starts degraded, then reaches offline at threshold — never auth_error", () => {
    let s = initialHealth();
    s = onFailure(s, { kind: "network", threshold });
    expect(s.status).toBe("degraded");
    s = onFailure(s, { kind: "network", threshold });
    expect(s.status).toBe("degraded");
    s = onFailure(s, { kind: "network", threshold });
    expect(s.status).toBe("offline");
  });

  it("an auth failure jumps straight to auth_error", () => {
    const s = onFailure(initialHealth(), { kind: "auth", threshold, message: "revoked" });
    expect(s.status).toBe("auth_error");
    expect(s.message).toBe("revoked");
  });

  it("success clears back to ok and resets the counter", () => {
    let s = onFailure(initialHealth(), { kind: "network", threshold });
    s = onSuccess(s);
    expect(s.status).toBe("ok");
    expect(s.consecutiveFailures).toBe(0);
  });
});
