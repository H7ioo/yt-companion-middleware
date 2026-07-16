import type { AppInfo, UpdateState } from "../api.js";

const SEEN_KEY = "ytc.lastSeenVersion";

/**
 * Whether the What's New panel should open by itself (PRD-09 §B.2).
 *
 * Only after an actual version change — never on a fresh install. Someone who just installed the
 * app for the first time wants the dashboard, not a list of what changed in a version they never
 * ran. The panel is still reachable on demand from the rail's version chip.
 */
export function shouldAnnounce(version: string, lastSeen: string | null): boolean {
  return lastSeen !== null && lastSeen !== version;
}

/** Reads the version this browser last acknowledged. Null on a first run (or private mode). */
export function readLastSeen(store: Pick<Storage, "getItem"> = localStorage): string | null {
  try {
    return store.getItem(SEEN_KEY);
  } catch {
    return null; // storage blocked — the panel just never auto-opens
  }
}

/** Records the running version as seen, so the panel announces once and not again. */
export function markSeen(version: string, store: Pick<Storage, "setItem"> = localStorage): void {
  try {
    store.setItem(SEEN_KEY, version);
  } catch {
    /* storage blocked — nothing to remember it with */
  }
}

/**
 * Splits our changelog's `**scope:** description` convention into its parts, so the UI can set the
 * scope apart without a markdown renderer. Items with no scope come back with scope: null.
 */
export function splitScope(item: string): { scope: string | null; text: string } {
  const match = /^\*\*(.+?):\*\*\s+(.*)$/.exec(item);
  return match ? { scope: match[1], text: match[2] } : { scope: null, text: item };
}

/**
 * The banner copy for an update state. Returns null whenever there is nothing worth interrupting
 * the operator for — no updater on this host, up to date, still checking, or a failed check (which
 * is logged, never surfaced: the app keeps running on its current version). A failed *download* is
 * different — the operator was already promised an update, so the banner says it broke and offers
 * a retry. The two are told apart by `version`: only a download failure carries one.
 */
export function describeUpdate(
  update: UpdateState,
): { title: string; note: string; installable: boolean; retryable: boolean } | null {
  if (update.status === "downloading") {
    const pct = typeof update.percent === "number" ? ` (${update.percent}%)` : "";
    return {
      title: `Update ${formatVersion(update.version)} downloading`,
      note: `Downloading in the background${pct}. Nothing restarts until you say so.`,
      installable: false,
      retryable: false,
    };
  }
  if (update.status === "downloaded") {
    return {
      title: `Update ${formatVersion(update.version)} ready to install`,
      note: "Installing restarts the app — Companion drops for a few seconds. Do this off air.",
      installable: true,
      retryable: false,
    };
  }
  if (update.status === "error" && update.version) {
    return {
      title: `Update ${formatVersion(update.version)} couldn't download`,
      note: "The download failed — you're still on the current version. Retry when you're ready.",
      installable: false,
      retryable: true,
    };
  }
  return null;
}

function formatVersion(version: string | undefined): string {
  return version ? `v${version.replace(/^v/, "")}` : "";
}

/**
 * Whether the update banner should offer its "What's in it" affordance: only when the offered
 * version actually carries notes from the update feed (PRD-10 §3). Kept out of the component so the
 * decision is unit-testable without a DOM — the banner's node test suite has no renderer.
 */
export function hasUpdateNotes(info: Pick<AppInfo, "updateNotes">): boolean {
  return typeof info.updateNotes === "string" && info.updateNotes.trim().length > 0;
}
