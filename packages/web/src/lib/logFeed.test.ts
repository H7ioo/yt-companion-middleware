import { describe, expect, it } from "vitest";
import type { LogEntry } from "../api.js";
import { reconcileEntries } from "./logFeed.js";

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  ts: "2026-07-12T10:00:00.000Z",
  level: "info",
  category: "system",
  code: null,
  message: "boot",
  ...over,
});

describe("reconcileEntries", () => {
  it("returns the SAME array reference when the poll is unchanged (the idle no-op)", () => {
    const current = [entry({ ts: "t1", message: "a" }), entry({ ts: "t2", message: "b" })];
    // A distinct array with identical rows, as a fresh fetch would produce.
    const fetched = [entry({ ts: "t1", message: "a" }), entry({ ts: "t2", message: "b" })];
    expect(reconcileEntries(current, fetched)).toBe(current);
  });

  it("returns the fetched array when a new entry has been appended", () => {
    const current = [entry({ ts: "t1", message: "a" })];
    const fetched = [entry({ ts: "t1", message: "a" }), entry({ ts: "t2", message: "b" })];
    expect(reconcileEntries(current, fetched)).toBe(fetched);
  });

  it("returns the fetched array when the newest row changed at the same length (ring rotated)", () => {
    const current = [entry({ ts: "t1", message: "a" }), entry({ ts: "t2", message: "b" })];
    const fetched = [entry({ ts: "t2", message: "b" }), entry({ ts: "t3", message: "c" })];
    expect(reconcileEntries(current, fetched)).toBe(fetched);
  });

  it("treats two empty polls as unchanged (same reference)", () => {
    const current: LogEntry[] = [];
    expect(reconcileEntries(current, [])).toBe(current);
  });

  it("distinguishes rows that share a timestamp but differ in content", () => {
    const current = [entry({ ts: "t1", message: "a", level: "info" })];
    const fetched = [entry({ ts: "t1", message: "a", level: "error" })];
    expect(reconcileEntries(current, fetched)).toBe(fetched);
  });
});
