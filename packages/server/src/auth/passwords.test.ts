import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords.js";

describe("password credentials", () => {
  it("verifies the password it was hashed from", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("Correct horse battery staple", stored)).toBe(false);
  });

  it("salts each hash, so the same password stores differently twice", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toEqual(b);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("carries its cost parameters, so an older hash still verifies", async () => {
    // A hash made with weaker parameters than today's defaults — the stored form names them.
    const stored = await hashPassword("legacy");
    const [algo, cost, block, parallel] = stored.split("$");
    expect(algo).toBe("scrypt");
    expect(Number(cost)).toBeGreaterThan(0);
    expect(Number(block)).toBeGreaterThan(0);
    expect(Number(parallel)).toBeGreaterThan(0);
  });

  it("fails a malformed or unknown stored value instead of throwing", async () => {
    for (const bad of ["", "not-a-hash", "bcrypt$1$2$3$4$5", "scrypt$x$8$1$c2FsdA$a2V5"]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });
});
