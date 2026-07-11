// LogEntry and its enums are part of the shared API contract (served by GET /api/dashboard/logs
// and consumed by the dashboard Activity panel), so they live in @app/shared and are re-exported.
export type { LogEntry, LogLevel, LogCategory } from "@app/shared";
import type { LogEntry, LogLevel, LogCategory } from "@app/shared";

const DEFAULT_CAPACITY = 200;

/** A log line to record — the timestamp is stamped by the buffer, so callers omit it. */
export type LogInput = Omit<LogEntry, "ts"> & { ts?: string };

/**
 * A small in-memory ring buffer of operational events (PRD-06 §3). Producers — the state cache,
 * action runner and quota tracker — push liberally; the dashboard reads the last `capacity`
 * entries newest-first. Nothing is persisted: it is a live activity feed, not an audit log, so a
 * restart starts fresh and the buffer never grows without bound.
 */
export class Logger {
  private buffer: LogEntry[] = [];

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

  /** Record an event. Drops the oldest entry once the buffer is full. Returns what was stored. */
  push(input: LogInput): LogEntry {
    const entry: LogEntry = {
      ts: input.ts ?? new Date().toISOString(),
      level: input.level,
      category: input.category,
      code: input.code ?? null,
      message: input.message,
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
    return entry;
  }

  /** The buffered events, newest-first (PRD-06 §3 — the order the panel renders). */
  list(): LogEntry[] {
    return this.buffer.slice().reverse();
  }

  /** Empties the buffer. Used by tests and, potentially, a dashboard "clear" control. */
  clear(): void {
    this.buffer = [];
  }
}

/**
 * Maps a PRD §7 error/action code to the activity-log category it belongs to, keeping the panel's
 * filter aligned with the health classification from issue 016. Codes outside the auth/network/
 * quota triad (a generic 5xx, an unknown failure) fall under `system`.
 */
export function categoryForCode(code: string | null): LogCategory {
  switch (code) {
    case "YOUTUBE_AUTH_ERROR":
      return "auth";
    case "NETWORK_ERROR":
      return "network";
    case "YOUTUBE_QUOTA_EXCEEDED":
      return "quota";
    default:
      return "system";
  }
}

/** Convenience: the severity a failure code should log at. Auth/network are hard errors. */
export function levelForCode(code: string | null): LogLevel {
  return code === "YOUTUBE_QUOTA_EXCEEDED" ? "warn" : "error";
}
