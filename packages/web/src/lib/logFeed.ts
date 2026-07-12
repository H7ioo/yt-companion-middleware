import type { LogEntry } from "../api.js";

/**
 * Decide the next entries state for the activity poll (PRD-11 §2). The activity log is an
 * append-only ring buffer, so two fetches are equal when they are the same length and share the
 * same newest row — a cheap check that avoids deep-comparing up to 200 entries every 4s. When they
 * match, the *current* array reference is returned unchanged, so a functional `setState` bails out
 * of the re-render and the memo recompute that a fresh (but identical) array would otherwise force
 * ~15×/minute on an idle dashboard. A genuinely new entry returns the fetched array.
 */
export function reconcileEntries(current: LogEntry[], fetched: LogEntry[]): LogEntry[] {
  if (current.length !== fetched.length) return fetched;
  if (current.length === 0) return current;
  const a = current[current.length - 1];
  const b = fetched[fetched.length - 1];
  if (
    a.ts === b.ts &&
    a.message === b.message &&
    a.level === b.level &&
    a.category === b.category &&
    a.code === b.code
  ) {
    return current;
  }
  return fetched;
}
