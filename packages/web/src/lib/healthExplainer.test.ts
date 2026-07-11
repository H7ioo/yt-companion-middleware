import { describe, expect, it } from "vitest";
import { HEALTH_GLOSSARY, type HealthStatus } from "@app/shared";
import { explainHealth } from "./healthExplainer.js";

const ALL: HealthStatus[] = ["ok", "degraded", "offline", "auth_error"];

describe("explainHealth", () => {
  it("draws label and meaning from the canonical glossary for every state", () => {
    for (const state of ALL) {
      const e = explainHealth(state);
      expect(e.label).toBe(HEALTH_GLOSSARY[state].label);
      expect(e.meaning).toBe(HEALTH_GLOSSARY[state].meaning);
    }
  });

  it("falls back to the raw code for an unknown state instead of throwing", () => {
    const e = explainHealth("weird" as HealthStatus);
    expect(e.label).toBe("weird");
    expect(e.meaning).toBeTruthy();
    expect(e.link).toBeNull();
  });

  it("offline links to the firewall panel", () => {
    const e = explainHealth("offline");
    expect(e.link).toEqual({ href: "#firewall", label: "See firewall steps" });
  });

  it("auth_error links to reconnect", () => {
    const e = explainHealth("auth_error");
    expect(e.link).toEqual({ href: "#reauth", label: "Reconnect YouTube" });
  });

  it("degraded reads as transient/retrying and offers no link", () => {
    const e = explainHealth("degraded");
    expect(e.meaning.toLowerCase()).toContain("retry");
    expect(e.link).toBeNull();
  });

  it("ok is healthy with no remedy link", () => {
    const e = explainHealth("ok");
    expect(e.link).toBeNull();
  });
});
