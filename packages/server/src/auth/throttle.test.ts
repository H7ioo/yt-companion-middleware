import { beforeEach, describe, expect, it } from "vitest";
import { LoginThrottle, MAX_ATTEMPTS } from "./throttle.js";

let now: number;
const MINUTE = 60 * 1000;

beforeEach(() => {
  now = Date.UTC(2026, 0, 1);
});

describe("LoginThrottle", () => {
  it("locks a caller out after too many failures", () => {
    const throttle = new LoginThrottle(() => now);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(throttle.check("1.2.3.4|operator").allowed).toBe(true);
      throttle.recordFailure("1.2.3.4|operator");
    }
    expect(throttle.check("1.2.3.4|operator").allowed).toBe(false);
  });

  it("lets the caller back in once the window passes", () => {
    const throttle = new LoginThrottle(() => now);
    for (let i = 0; i < MAX_ATTEMPTS; i++) throttle.recordFailure("caller");
    expect(throttle.check("caller").allowed).toBe(false);
    now += 16 * MINUTE;
    expect(throttle.check("caller").allowed).toBe(true);
  });

  it("says how long the lockout has left", () => {
    const throttle = new LoginThrottle(() => now);
    for (let i = 0; i < MAX_ATTEMPTS; i++) throttle.recordFailure("caller");
    now += 5 * MINUTE;
    expect(throttle.check("caller").retryAfterMs).toBe(10 * MINUTE);
  });

  it("forgives a typo once the caller gets in", () => {
    const throttle = new LoginThrottle(() => now);
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) throttle.recordFailure("caller");
    throttle.reset("caller");
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) throttle.recordFailure("caller");
    expect(throttle.check("caller").allowed).toBe(true);
  });

  it("locks out one caller without locking out anyone else", () => {
    const throttle = new LoginThrottle(() => now);
    for (let i = 0; i < MAX_ATTEMPTS; i++) throttle.recordFailure("attacker");
    expect(throttle.check("attacker").allowed).toBe(false);
    expect(throttle.check("operator-at-home").allowed).toBe(true);
  });

  it("counts the window from the first failure, so failing slowly still locks out", () => {
    const throttle = new LoginThrottle(() => now);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      throttle.recordFailure("caller");
      now += 2 * MINUTE;
    }
    expect(throttle.check("caller").allowed).toBe(false);
  });
});
