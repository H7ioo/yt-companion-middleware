/**
 * "Is tonight's broadcast ready?" — answered from the ownership record alone (PRD-16 §2, issue 063).
 *
 * The list of broadcasts this app created is already persisted (issue 062) and already the only
 * thing that knows which broadcasts are ours. This turns that list into the one sentence a
 * Companion key can show and a dashboard can print: which broadcast is next, and whether the
 * encoder will actually reach it.
 *
 * Free, deliberately. Nothing here asks YouTube anything — it reads the record — so the answer can
 * ride the same state push as everything else and a key can hold it without spending quota to.
 * The trade is that the metadata is a snapshot of what was asked for at insert, never a mirror of
 * the channel; the sweep (issue 064) is what reconciles the record with reality.
 */
import type { PreparedBroadcast } from "./schema.js";
import { PREPARED_GLOSSARY, type PreparedState, type PreparedTerm } from "./glossary.js";

/**
 * How long after its slot an unused broadcast stops being tonight's show and becomes a leftover.
 *
 * The sweep's window (issue 064), and it lives here so the two agree by construction: a readout
 * that still called a broadcast "prepared" after the sweep had decided it was a leftover — or,
 * worse, the other way round — would be a lamp disagreeing with the thing it reports on.
 */
export const RETIRE_GRACE_MS = 12 * 60 * 60 * 1000;

/**
 * The prepared-broadcast answer, with the glossary's words already attached — the same shape the
 * ingestion readout uses, and for the same reason: the Companion module is bundled standalone and
 * cannot import this glossary at runtime, so the copy travels with the state instead of being
 * re-written on the other side.
 */
export interface PreparedReadout extends PreparedTerm {
  state: PreparedState;
  /** The broadcast this is about, or null when nothing is prepared. */
  id: string | null;
  title: string | null;
  /** The public link, ready to read off a key or copy out of the dashboard. */
  watchUrl: string | null;
  scheduledStartTime: string | null;
  /** The ingestion key it is bound to; null is precisely the `unbound` state. */
  streamId: string | null;
}

/**
 * Reduces the ownership record to the next broadcast still standing, and says whether it is bound.
 *
 * Standing means: this app made it, it has not been on air, this app has not retired it, and its
 * slot has not passed by more than the sweep's grace window. Aired records are excluded because
 * the question has moved on — the on-air lamp answers it from then, and a "prepared" key still lit
 * through the service is one more surface showing yesterday's news.
 *
 * "Next" is the soonest scheduled start, and being bound never promotes a broadcast over a sooner
 * one. The unbound broadcast an hour from now is the one that will fail, and reporting the tidy
 * one behind it would hide exactly the fault this readout exists to show.
 */
export function summarizePrepared(records: PreparedBroadcast[], nowMs: number): PreparedReadout {
  const standing = (records ?? []).filter((r) => isStanding(r, nowMs));
  standing.sort((a, b) => dueAt(a) - dueAt(b));
  const next = standing[0];
  if (!next) return { state: "none", ...PREPARED_GLOSSARY.none, ...empty() };
  const state: PreparedState = next.streamId ? "prepared" : "unbound";
  return {
    state,
    ...PREPARED_GLOSSARY[state],
    id: next.id,
    title: next.title,
    watchUrl: next.watchUrl,
    scheduledStartTime: next.scheduledStartTime,
    streamId: next.streamId,
  };
}

function empty(): Omit<PreparedReadout, keyof PreparedTerm | "state"> {
  return { id: null, title: null, watchUrl: null, scheduledStartTime: null, streamId: null };
}

function isStanding(record: PreparedBroadcast, nowMs: number): boolean {
  if (record.airedAt !== null || record.retiredAt !== null) return false;
  // Falls back to `createdAt` exactly as planSweep does, so an undated record ages out rather than
  // standing forever; an unparseable pair leaves it standing, because dropping a broadcast we
  // cannot date would hide a real one over a bad timestamp.
  const due = dueAt(record);
  if (!Number.isFinite(due)) return true;
  return nowMs - due < RETIRE_GRACE_MS;
}

/** When this broadcast is due, in ms — its slot, or failing that when it was made. */
function dueAt(record: PreparedBroadcast): number {
  const scheduled = record.scheduledStartTime ? Date.parse(record.scheduledStartTime) : NaN;
  if (!Number.isNaN(scheduled)) return scheduled;
  const created = Date.parse(record.createdAt);
  return Number.isNaN(created) ? Number.POSITIVE_INFINITY : created;
}
