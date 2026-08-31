import type { JsonStore } from "../storage/jsonStore.js";
import type { GraceReadout } from "@app/shared";

/**
 * Grace mode: authentication switched off for the Companion-facing endpoints, plus the evidence
 * for turning it back on (PRD-15 §4, settled in issue 042, built in issue 047, flipped in 049).
 *
 * The module in the field cannot send a token — v2.0.0 *removed* the field and ships an upgrade
 * script that strips it — so guarding `/api/action` and `/api/feedback` today is the go-dark
 * outage the PRD describes. Grace mode is the way through that: those endpoints accept a
 * tokenless caller, **but never silently**. Every one is recorded, and the dashboard carries a
 * standing warning naming what is still connecting the old way.
 *
 * The exit condition is **two counters, not one**, and that is the whole reason this class exists
 * rather than a boolean somewhere:
 *
 *   *no tokenless client has connected in 14 consecutive days, spanning at least one go-live*
 *
 * The days half alone is not evidence. A 14-day off-season satisfies it while the still-tokenless
 * Companion machine sits powered down — grace mode comes off, and the next show goes dark. So a
 * go-live counter runs beside the clock, both are reset by any tokenless connection, and the
 * readout says "met" only when both hold.
 */

/** Consecutive days without a tokenless connection before the clock half is satisfied. */
export const GRACE_DAYS_REQUIRED = 14;
/** Go-lives that must fall inside those days. One is enough: it proves a show ran with a token. */
export const GRACE_GO_LIVES_REQUIRED = 1;
/** Longest client string kept. A caller controls this header; the store should not grow with it. */
const MAX_CLIENT_LENGTH = 200;
/**
 * How often a *continuing* stream of tokenless connections is written to disk.
 *
 * Companion polls every few seconds and every store write rewrites the whole file, so recording
 * each connection where it happens would rewrite `store.json` every five seconds for the entire
 * migration. The window this feeds is fourteen days, so five-minute granularity costs the readout
 * nothing. What is *not* deferred is the first tokenless connection after a quiet stretch — see
 * {@link Grace.recordTokenless}.
 */
const RECORD_GRANULARITY_MS = 5 * 60 * 1000;

/** One tokenless caller, as the guard sees it. */
export interface TokenlessCaller {
  /** How it identified itself — the user agent, or null when it sent none. */
  client: string | null;
  /** Where it came from, honouring a trusted proxy the same way sign-in throttling does. */
  from: string | null;
  /** Which endpoint it reached, so "the module" can be told from "somebody's curl". */
  route: string;
}

export class Grace {
  private readonly store: JsonStore;
  private readonly now: () => number;
  /**
   * Tokenless connections counted but not yet written, held here so the deferral above costs
   * accuracy rather than losing connections outright: the next write adds all of them. A crash
   * inside the window forgets at most five minutes of a number that measures a migration.
   */
  private unflushed = 0;

  constructor(store: JsonStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }

  /** Whether tokenless Companion callers are refused. Read on every request, so kept cheap. */
  get enforcing(): boolean {
    return this.store.get().grace.enforcing;
  }

  /**
   * Turns enforcement on or off at runtime (issue 049). Persisted rather than read from the
   * environment, so the rollback is a click at 8pm on a show night, not a redeploy.
   */
  async setEnforcing(enforcing: boolean): Promise<void> {
    await this.store.update((s) => {
      s.grace.enforcing = enforcing;
    });
  }

  /**
   * Records a connection that carried no token. Resets **both** halves of the exit condition: a
   * show that ran tokenless is exactly the case the go-live counter exists to catch, and letting
   * it reset only the clock would make the counter decorative.
   */
  async recordTokenless(caller: TokenlessCaller): Promise<void> {
    this.unflushed += 1;
    const now = this.now();
    const stored = this.store.get().grace;

    // Deferred only while a tokenless caller is *already* the recorded state and nothing about
    // the verdict would change. The moment either half of the exit condition would move — the
    // first tokenless connection ever, or the first after a stretch that had started to count —
    // the write happens here, because "met" going stale for five minutes is the readout being
    // wrong about the one question it exists to answer.
    const wouldChangeVerdict =
      stored.lastTokenlessAt === null || stored.goLivesSinceTokenless > 0;
    const stale = stored.lastTokenlessAt
      ? now - Date.parse(stored.lastTokenlessAt) >= RECORD_GRANULARITY_MS
      : true;
    if (!wouldChangeVerdict && !stale) return;

    const at = new Date(now).toISOString();
    const counted = this.unflushed;
    this.unflushed = 0;
    try {
      await this.store.update((s) => {
        s.grace.lastTokenlessAt = at;
        s.grace.lastTokenlessClient = caller.client
          ? caller.client.slice(0, MAX_CLIENT_LENGTH)
          : null;
        s.grace.lastTokenlessFrom = caller.from ?? null;
        s.grace.lastTokenlessRoute = caller.route;
        s.grace.tokenlessCount += counted;
        s.grace.goLivesSinceTokenless = 0;
        // `lastGoLiveId` is deliberately *kept*. It is what stops the show currently on air from
        // being re-counted by the very next poll — and a show that ran while something was still
        // connecting tokenless is not the evidence this counter exists to collect. Clearing it
        // instead put the two paths into a loop: the poll re-counted the live show, which made
        // the next tokenless request's verdict change again, and the pair rewrote the whole store
        // twice per poll for the length of a broadcast — what the deferral above exists to stop.
      });
    } catch (err) {
      // The counts go back on the pile rather than down the drain, and the failure is not the
      // caller's problem: recording is bookkeeping alongside a Companion action that is otherwise
      // fine, and 500-ing a cue because a disk write failed is the outage grace mode exists to
      // avoid. The next successful write carries these connections with it.
      this.unflushed += counted;
      console.error("[grace] failed to record a tokenless connection:", err);
    }
  }

  /**
   * Counts a broadcast that is on air. Called from the poll loop, which sees the same live
   * broadcast every few seconds — so the id is remembered and one show counts once, or a single
   * evening would read as a thousand go-lives and satisfy the condition by itself.
   */
  async recordGoLive(broadcastId: string): Promise<void> {
    if (this.store.get().grace.lastGoLiveId === broadcastId) return;
    await this.store.update((s) => {
      // Re-checked inside the update for the usual reason: two refreshes in flight at once would
      // both read the old id and both count the same show.
      if (s.grace.lastGoLiveId === broadcastId) return;
      s.grace.lastGoLiveId = broadcastId;
      s.grace.goLivesSinceTokenless += 1;
    });
  }

  /**
   * The evidence, in the shape the dashboard renders. Both counters are reported whatever the
   * verdict, because the operator deciding when to flip the switch is reading the halves, not
   * trusting a boolean.
   */
  readout(): GraceReadout {
    const g = this.store.get().grace;
    const days = g.lastTokenlessAt
      ? Math.floor((this.now() - Date.parse(g.lastTokenlessAt)) / (24 * 60 * 60 * 1000))
      : null;
    // Null days means nothing has ever connected tokenless, so there is no clock to run down —
    // but the go-live half still has to hold, or a server installed an hour ago would read as
    // proven before it had ever carried a show.
    const daysHold = days === null || days >= GRACE_DAYS_REQUIRED;
    const goLivesHold = g.goLivesSinceTokenless >= GRACE_GO_LIVES_REQUIRED;
    return {
      enforcing: g.enforcing,
      daysSinceTokenless: days,
      daysRequired: GRACE_DAYS_REQUIRED,
      goLivesSinceTokenless: g.goLivesSinceTokenless,
      goLivesRequired: GRACE_GO_LIVES_REQUIRED,
      met: daysHold && goLivesHold,
      lastTokenlessAt: g.lastTokenlessAt,
      lastTokenlessClient: g.lastTokenlessClient,
      lastTokenlessFrom: g.lastTokenlessFrom,
      lastTokenlessRoute: g.lastTokenlessRoute,
      // Plus whatever has not been written yet, so the dashboard's total is the real one rather
      // than the last one that happened to hit the disk.
      tokenlessCount: g.tokenlessCount + this.unflushed,
    };
  }
}
