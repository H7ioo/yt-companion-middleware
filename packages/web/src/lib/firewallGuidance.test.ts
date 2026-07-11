import { describe, expect, it } from "vitest";
import {
  FIREWALL_GUIDANCE,
  OFFLINE_EXPLANATION,
  OFFLINE_TITLE,
} from "./firewallGuidance.js";

describe("firewall guidance content (PRD-06 §2)", () => {
  it("explains this is a network/firewall problem, not a login one", () => {
    // Wording parity (#10): the panel must not send the operator toward reauth.
    expect(OFFLINE_EXPLANATION).toMatch(/firewall|network/i);
    expect(OFFLINE_EXPLANATION).toMatch(/not a login/i);
    expect(OFFLINE_TITLE).not.toMatch(/reconnect|reauth|sign.?in/i);
  });

  it("covers both Windows and Linux with steps", () => {
    const osNames = FIREWALL_GUIDANCE.map((g) => g.os);
    expect(osNames).toContain("Windows");
    expect(osNames).toContain("Linux");
    for (const g of FIREWALL_GUIDANCE) {
      expect(g.steps.length).toBeGreaterThan(0);
    }
  });

  it("names outbound HTTPS 443 to *.googleapis.com in every OS section", () => {
    for (const g of FIREWALL_GUIDANCE) {
      const blob = g.steps.map((s) => `${s.text} ${s.command ?? ""}`).join(" ");
      expect(blob).toMatch(/443/);
      expect(blob).toMatch(/googleapis\.com/);
    }
  });

  it("gives copyable ufw and firewalld commands on Linux, and a Defender note on Windows", () => {
    const linux = FIREWALL_GUIDANCE.find((g) => g.os === "Linux")!;
    const commands = linux.steps.map((s) => s.command).filter(Boolean).join("\n");
    expect(commands).toMatch(/ufw/);
    expect(commands).toMatch(/firewall-cmd/);

    const windows = FIREWALL_GUIDANCE.find((g) => g.os === "Windows")!;
    const winText = windows.steps.map((s) => s.text).join(" ");
    expect(winText).toMatch(/Defender Firewall/i);
  });
});
