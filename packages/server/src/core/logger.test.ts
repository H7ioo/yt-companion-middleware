import { describe, expect, it } from "vitest";
import { Logger, categoryForCode } from "./logger.js";

describe("Logger ring buffer (PRD-06 §3)", () => {
  it("lists a pushed entry, stamping a timestamp", () => {
    const log = new Logger();
    log.push({ level: "info", category: "system", code: null, message: "Server ready" });
    const [entry] = log.list();
    expect(entry.message).toBe("Server ready");
    expect(entry.category).toBe("system");
    expect(entry.code).toBeNull();
    expect(typeof entry.ts).toBe("string");
    expect(Number.isNaN(Date.parse(entry.ts))).toBe(false);
  });

  it("returns entries newest-first", () => {
    const log = new Logger();
    log.push({ level: "info", category: "action", code: null, message: "first" });
    log.push({ level: "warn", category: "network", code: "NETWORK_ERROR", message: "second" });
    expect(log.list().map((e) => e.message)).toEqual(["second", "first"]);
  });

  it("caps at capacity, dropping the oldest events", () => {
    const log = new Logger(3);
    for (let i = 0; i < 5; i++) {
      log.push({ level: "info", category: "system", code: null, message: `e${i}` });
    }
    const messages = log.list().map((e) => e.message);
    expect(messages).toEqual(["e4", "e3", "e2"]);
    expect(messages).not.toContain("e0");
  });
});

describe("categoryForCode", () => {
  it("maps the 016 failure codes to their categories", () => {
    expect(categoryForCode("YOUTUBE_AUTH_ERROR")).toBe("auth");
    expect(categoryForCode("NETWORK_ERROR")).toBe("network");
    expect(categoryForCode("YOUTUBE_QUOTA_EXCEEDED")).toBe("quota");
  });

  it("falls back to system for anything unclassified", () => {
    expect(categoryForCode("YOUTUBE_ERROR")).toBe("system");
    expect(categoryForCode(null)).toBe("system");
  });
});
