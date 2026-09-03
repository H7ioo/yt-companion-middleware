import type { youtube_v3 } from "googleapis";
import type { JsonStore } from "../storage/jsonStore.js";
import type { CacheState, PendingMetadata, TargetConflict } from "../storage/schema.js";
import { getBroadcast, listBroadcasts, resolveTarget, toStatus } from "../youtube/broadcasts.js";
import { isAuthError, isNetworkError, mapYouTubeError } from "../youtube/client.js";
import { initialHealth, onFailure, onSuccess, type HealthState } from "./health.js";
import type { StateEvents } from "./events.js";
import { categoryForCode, levelForCode, type Logger } from "./logger.js";
import { isFastWindow, pollIntervalMs, type CadenceInput } from "./pollCadence.js";
import { readIngestion } from "../youtube/ingestion.js";
import { eligibilityRefusal, isEligibilityError, noteRidingMode } from "../youtube/eligibility.js";

/**
 * Holds the state served to Companion feedback endpoints (PRD §5.4). All feedback reads
 * come from here, never a live YouTube call, so Companion polling costs zero quota.
 *
 * The cache is refreshed automatically after every successful action, plus a background
 * timer every `refreshIntervalMs` to catch out-of-band changes (e.g. a stream ended from
 * YouTube Studio).
 */
/**
 * How long a latched intent stays valid. Long enough to cover setting a title well before the
 * show and YouTube minting the broadcast at the last minute; short enough that yesterday's title
 * never lands on tonight's stream.
 */
const PENDING_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How long one refresh may take before it is abandoned as hung.
 *
 * The googleapis client has no request timeout of its own, so a socket that opens and then never
 * answers (captive portal, half-open NAT) leaves the promise pending forever. With refreshes
 * deduped onto the in-flight run, that one request would wedge every later refresh: health would
 * stay green on stale state and /action/refresh would never respond. Generous enough that a slow
 * link still completes within the 60s refresh interval.
 */
const REFRESH_TIMEOUT_MS = 20_000;

/**
 * How long a cached ingestion reading stays believable once the loop has stopped re-reading it.
 * Long enough that a manual check while idle is not thrown away on the next tick, short enough
 * that no surface reports "receiving video" about a show that ended hours ago.
 */
const INGESTION_STALE_MS = 5 * 60_000;

/** Rejects with a NETWORK_ERROR-shaped failure if `p` has not settled within the timeout. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`YouTube did not respond within ${Math.round(ms / 1000)}s`) as Error & {
        code?: string;
      };
      err.code = "ETIMEDOUT";
      reject(err);
    }, ms);
    timer.unref?.(); // never hold the process open on the watchdog alone
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/**
 * The target changed while we were idle and nothing else explained it — something outside this
 * app (almost always YouTube Studio) is creating broadcasts. Reported only when idle: once live,
 * the active broadcast is authoritative and a change of id is just the show starting.
 */
function driftConflict(
  previous: CacheState,
  target: { id: string; isLive: boolean; autoStartMint: boolean },
): TargetConflict | null {
  if (target.isLive || !previous.lastTargetId || previous.lastTargetId === target.id) return null;
  // The show starting is not drift. With an auto-start encoder YouTube mints the broadcast that
  // airs about a minute before air (PRD-12 §2), so the target legitimately changes while still
  // idle — warning "close Studio's stream page" seconds before going live is pure noise, and the
  // pending-metadata replay already handles the handover.
  if (target.autoStartMint) return null;
  if (previous.status.isLive) return null; // a show just ended — a new target is expected
  return {
    code: "TARGET_DRIFT",
    message:
      "The broadcast being edited changed on its own — something else (usually YouTube Studio) is creating broadcasts. Close Studio's stream page, or check which one you are about to start.",
    ids: [previous.lastTargetId, target.id],
  };
}

export class StateCache {
  private health: HealthState = initialHealth();
  private timer: NodeJS.Timeout | null = null;
  /** Whether the poll loop is meant to keep re-arming; cleared by stop(). */
  private running = false;
  /** The refresh currently in flight, if any — see the note on refresh(). */
  private inFlight: Promise<void> | null = null;
  /** Set post-construction via setReplayHandler — see the note there on the runner/cache cycle. */
  private replay: ((pending: PendingMetadata) => Promise<unknown>) | null = null;
  /**
   * No refresh has reached YouTube yet in this process. `lastTargetId` is persisted in the store,
   * so after a restart it names last session's target — comparing against it would raise a
   * TARGET_DRIFT banner for a full refresh interval, typically mid pre-show setup, when nothing
   * has drifted at all. Drift is a claim about change *observed while running*, so the first
   * refresh only records the target.
   */
  private firstRefresh = true;

  /**
   * When the last full refresh was started. The fast window replaces most ticks with a 1-unit
   * probe, but a probe answers only "is anything active?" — it never runs resolveTarget, so on
   * its own it would suspend conflict detection (MULTIPLE_UPCOMING, SHARED_STREAM_KEY,
   * TARGET_DRIFT), out-of-band Studio edits and the `lastRefreshedAt` heartbeat for the whole
   * 30 minutes, during exactly the pre-show setup those were built for. So the normal interval
   * keeps its full refresh; probes ride between them.
   */
  private lastFullRefreshStartedAt = 0;
  /** The stream the last-seen target broadcast is bound to, if any. See refreshIngestion. */
  private boundStreamId: string | null = null;

  /**
   * Bumped every time the active preset is set or cleared. A refresh samples it before its GET and
   * hands it back to reconcileActivePreset, which then knows whether the title it is holding
   * predates the preset now on record.
   */
  private presetEpoch = 0;

  /**
   * Told about every broadcast observed on air, set post-construction (issue 047). Grace mode's
   * exit condition needs a go-live counter beside its clock, and the poll loop is the one place
   * that already watches broadcasts change state — so the counter is fed from here rather than
   * from a second watcher that would have its own quota cost and its own way to be wrong.
   */
  private onLive: ((broadcastId: string) => void | Promise<void>) | null = null;

  constructor(
    private readonly yt: youtube_v3.Youtube,
    private readonly store: JsonStore,
    private readonly opts: { refreshIntervalMs: number; healthFailureThreshold: number },
    private readonly events?: StateEvents,
    private readonly logger?: Logger,
  ) {}

  /**
   * Registers the go-live watcher. Set after construction like the replay handler, because Auth
   * and the cache are built at different points in the boot and neither should have to know the
   * other exists to be constructed.
   */
  setGoLiveHandler(handler: (broadcastId: string) => void | Promise<void>): void {
    this.onLive = handler;
  }

  /**
   * Reports a broadcast seen on air. Deduplication of "the same show, seen every five seconds"
   * is the watcher's job, not this one's — it holds the id it last counted, and this call has no
   * memory of its own to drift from it.
   *
   * A failure here is swallowed: a counter for a migration readout must never be the reason a
   * refresh that reached YouTube gets recorded as a failed one.
   */
  private async noteGoLive(target: { id: string; isLive: boolean }): Promise<void> {
    if (!this.onLive || !target.isLive) return;
    try {
      await this.onLive(target.id);
    } catch (err) {
      console.warn("[stateCache] go-live watcher failed:", err);
    }
  }

  /** Emit a "connection recovered" line when a refresh clears a previously-unhealthy state. */
  private logRecovery(wasUnhealthy: boolean): void {
    if (!wasUnhealthy) return;
    this.logger?.push({
      level: "info",
      category: "system",
      code: null,
      message: "Connection to YouTube recovered",
    });
  }

  /** Current cache snapshot from the store. */
  snapshot(): CacheState {
    return this.store.get().cache;
  }

  /**
   * Perform a live GET and repopulate the cache. Updates health on success/failure.
   *
   * Concurrent callers (the background timer and a manual /action/refresh) share the in-flight
   * run rather than racing. Two overlapping refreshes would both read the same armed latch and
   * replay it twice — a double write to the live broadcast, with the second replay's undo
   * snapshot capturing the first one's result.
   *
   * `force` opts out of joining an in-flight run and chains a fresh one behind it instead. The
   * operator pressing "Re-check" after deleting a stray broadcast needs an answer from a call
   * made *after* the deletion; joining a refresh that started earlier would report their correct
   * fix as unfixed.
   */
  refresh(opts: { force?: boolean } = {}): Promise<void> {
    if (this.inFlight && !opts.force) return this.inFlight;
    this.lastFullRefreshStartedAt = Date.now();
    const prior = this.inFlight;
    const run: Promise<void> = (async () => {
      // Its failure is its own caller's business — runRefresh already recorded it on health.
      if (prior) await prior.catch(() => {});
      const reached = await withTimeout(this.runRefresh(), REFRESH_TIMEOUT_MS).then(
        () => true,
        async (err) => {
          await this.recordFailure(err);
          return false;
        },
      );
      // Deliberately outside the watchdog above. Inside it, a hung `liveStreams.list` would trip
      // the 20s timeout and land on `recordFailure` — degrading health toward offline over a
      // secondary read, which is the exact opposite of what refreshIngestion promises. Skipped
      // when the refresh itself failed: YouTube is not answering, and a second call proves it
      // twice at twice the quota.
      if (reached) await this.refreshIngestion();
    })().finally(() => {
      // Only clear if no later forced refresh has since taken the slot.
      if (this.inFlight === run) this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async runRefresh(): Promise<void> {
    // Master switch off: make no YouTube call. The background timer keeps ticking so polling
    // resumes the instant the operator re-enables the API, but while off it costs zero quota.
    if (!this.store.get().service.apiEnabled) return;
    const wasUnhealthy = this.health.status !== "ok";
    // Captured before the GET: a preset applied while these calls are in flight makes the title
    // we are about to read stale, and reconciling a fresh preset against a pre-action title would
    // clear it the instant it was pressed. See reconcileActivePreset.
    const presetEpoch = this.presetEpoch;
    try {
      const { conflict, ...target } = await resolveTarget(
        this.yt,
        Date.now(),
        this.store.get().targetPin?.id ?? null,
      );
      const broadcast = await getBroadcast(this.yt, target.id);
      const status = toStatus(broadcast);
      // The key the broadcast about to air is actually bound to — which is not always the one
      // named as the default. See refreshIngestion.
      this.boundStreamId = broadcast.contentDetails?.boundStreamId ?? null;
      this.health = onSuccess(this.health);
      this.logRecovery(wasUnhealthy);
      const previous = this.snapshot();
      const first = this.firstRefresh;
      this.firstRefresh = false;
      // A latched replay about to land the operator's metadata on this freshly minted broadcast
      // means the title just read is YouTube's placeholder, not evidence the preset came off air.
      // Skipping the reconcile leaves the preset lit; if the replay fails, the next refresh (with
      // the latch now cleared) reconciles and drops it.
      const replaying = this.replayEligible(previous, target);
      await this.writeCache({
        status: { ...status, noTarget: false },
        health: "ok",
        healthMessage: null,
        lastRefreshedAt: new Date().toISOString(),
        targetConflict: conflict ?? (first ? null : driftConflict(previous, target)),
        lastTargetId: target.id,
        // Read before this write lands, so it compares against the preset recorded so far.
        ...(replaying
          ? {}
          : this.reconcileActivePreset(status.title ?? null, presetEpoch, target.id)),
      });
      // Ordered after the cache write so the dashboard reflects the live broadcast even if the
      // replay itself fails; the replay writes the cache again on success.
      await this.replayPendingIfNeeded(previous, target);
      await this.noteGoLive(target);
    } catch (err) {
      const mapped = mapYouTubeError(err);
      // An idle channel with no active/persistent broadcast is an expected state, not a
      // health failure. Keep health green and flag it as "no target" rather than
      // escalating toward auth_error (PRD §5.4 is about API failures, not empty results).
      if (mapped.code === "NO_TARGET_FOUND") {
        // No broadcast, so nothing is bound to anything; fall back to the named default key.
        this.boundStreamId = null;
        this.health = onSuccess(this.health);
        this.logRecovery(wasUnhealthy);
        await this.writeCache({
          status: {
            broadcastId: null,
            title: null,
            privacyStatus: null,
            isLive: false,
            noTarget: true,
          },
          health: "ok",
          healthMessage: null,
          lastRefreshedAt: new Date().toISOString(),
          // The channel has no target at all, so any conflict about *which* target we picked is
          // over. Forgetting the id matters just as much: keeping it would make the next
          // broadcast created — the normal way a show is set up — look like drift.
          targetConflict: null,
          lastTargetId: null,
          // No broadcast at all, so no preset is on air either — unless the preset was written to
          // a broadcast this refresh simply could not see. An empty list is routinely transient
          // during the upcoming -> active handover, and clearing on it drops the preset for good
          // (the replay lands the title but never re-lights the key), so pass no target id and let
          // reconcileActivePreset hold on to a preset that names one.
          ...this.reconcileActivePreset(null, presetEpoch, null),
        });
        return;
      }
      await this.recordFailure(mapped);
    }
  }

  /**
   * Reads what YouTube is seeing on the ingestion key the show is bound to, and caches it (059).
   *
   * Cached rather than read per request because every Companion feedback is served from this
   * cache at zero quota, and a feedback that reached out to YouTube on each poll would cost more
   * than the whole rest of the module put together.
   *
   * The cost is paid only when the answer can matter: while a broadcast is live, and inside the
   * same armed window the fast probe uses — the pre-show "is it stuck on preparing?" gap. At one
   * unit per full refresh that is ~60 units an hour on a show night, against 10,000 a day. Idle at
   * three in the afternoon it spends nothing, which is the state the app is in most of its life.
   *
   * A failure here is swallowed on purpose: the refresh that just ran *did* reach YouTube, and
   * letting a secondary read degrade health would report a working connection as broken.
   */
  private async refreshIngestion(): Promise<void> {
    // The bound key first: the question is "is video arriving for tonight's show", and the show
    // is the broadcast about to air. When it is bound to a key other than the named default —
    // the mismatch willAir.ts models — reporting on the default answers the wrong question in
    // both directions, green while nothing arrives and red while the show is fine.
    const streamId = this.boundStreamId ?? this.store.get().defaults.defaultStreamBoundId;
    // No key named, so there is nothing to ask about — and any reading still held is about a key
    // the operator has since stopped calling the default. Stale is tolerable, wrong is not.
    if (!streamId) {
      if (this.snapshot().ingestion) await this.writeCache({ ingestion: null });
      return;
    }
    // A reading about some other key is about a question nobody asked; drop it rather than let
    // the panel name one key while the lamp reports another.
    const held = this.snapshot().ingestion;
    if (held && held.streamId !== streamId) await this.writeCache({ ingestion: null });
    if (!this.ingestionWorthReading()) {
      await this.expireStaleIngestion();
      return;
    }
    try {
      const snapshot = await withTimeout(
        readIngestion(this.yt, streamId, new Date().toISOString()),
        REFRESH_TIMEOUT_MS,
      );
      await this.writeCache({ ingestion: snapshot });
    } catch (err) {
      // Not recordFailure: see the note above. Logged at debug level only — a mid-show panel
      // filling with "could not read ingestion" would bury the entries that matter.
      console.warn("[stateCache] ingestion read failed:", err);
    }
  }

  /**
   * Drops a reading that has stopped being re-read (issue 059).
   *
   * The loop only spends a unit while a show is on or a latch is armed. Without this, the last
   * reading taken before the show ended stays in the cache forever — so a Companion key bound to
   * the ingestion feedback sits green all night on a key nothing has pushed to since ten o'clock.
   * The grace window is what keeps a manual "Check now" at three in the afternoon useful: the
   * answer the operator just paid for survives the next idle tick, it just does not survive the
   * evening.
   */
  private async expireStaleIngestion(): Promise<void> {
    const held = this.snapshot().ingestion;
    if (!held) return;
    const age = Date.now() - Date.parse(held.checkedAt);
    if (Number.isFinite(age) && age < INGESTION_STALE_MS) return;
    await this.writeCache({ ingestion: null });
  }

  /**
   * Whether an ingestion reading is worth a quota unit right now: something is on air, or a latch
   * is armed and still inside the fast window. The same predicate the poll cadence uses, so the
   * readout is fresh exactly while the app is already looking hard, and free the rest of the time.
   */
  private ingestionWorthReading(): boolean {
    if (!this.store.get().service.apiEnabled) return false;
    if (this.snapshot().status.isLive) return true;
    return isFastWindow(this.cadenceInput());
  }

  /**
   * Marks the connection healthy after a call that reached YouTube. `onSuccess` runs
   * unconditionally — a run of failures still under the threshold leaves health "ok" but the
   * counter part-way to `offline`, and that counter is exactly what a success has to clear.
   */
  private async recordSuccess(): Promise<void> {
    const wasUnhealthy = this.health.status !== "ok";
    this.health = onSuccess(this.health);
    if (!wasUnhealthy) return;
    this.logRecovery(wasUnhealthy);
    await this.writeCache({ health: "ok", healthMessage: null });
  }

  /**
   * Degrades health and reports a failed refresh. Called from runRefresh's own catch, and from
   * refresh() for a run abandoned by the watchdog — that rejection never reaches the catch below,
   * because the hung request simply never settles.
   */
  private async recordFailure(err: unknown): Promise<void> {
    const mapped = mapYouTubeError(err);
    // YouTube answered, and answered definitively: this channel may not create broadcasts
    // (issue 061). That is a permissions fact about the channel, not a failure of the
    // connection — the same reasoning that keeps NO_TARGET_FOUND above out of health. Degrading
    // here would eventually read as `offline` on a channel we are talking to perfectly well, and
    // the refusal would come back on the very next poll, so it would never clear.
    if (isEligibilityError(mapped)) {
      // The reason rides on the AppError: the calls in broadcasts.ts map their errors at the call
      // site, so the Gaxios body is long gone by the time a failure reaches here.
      const refusal = mapped.reason ?? eligibilityRefusal(err);
      if (refusal) {
        await noteRidingMode(this.store, {
          reason: refusal,
          message: mapped.message,
          now: new Date().toISOString(),
        });
      }
      await this.recordSuccess();
      this.logger?.push({
        level: "warn",
        category: "system",
        code: mapped.code,
        message: mapped.message,
      });
      return;
    }
    const kind = isAuthError(mapped) ? "auth" : isNetworkError(mapped) ? "network" : "transient";
    this.health = onFailure(this.health, {
      kind,
      threshold: this.opts.healthFailureThreshold,
      message: mapped.message,
    });
    // targetConflict/lastTargetId are deliberately left alone: the call failed, so we learned
    // nothing new about the target. Clearing them would drop a real conflict on one flaky
    // request; they are recomputed by the next refresh that actually reaches YouTube.
    await this.writeCache({
      health: this.health.status,
      healthMessage: this.health.message,
    });
    this.logger?.push({
      level: levelForCode(mapped.code),
      category: categoryForCode(mapped.code),
      code: mapped.code,
      message: mapped.message,
    });
    console.warn(`[stateCache] refresh failed (${mapped.code}): ${mapped.message}`);
  }

  /**
   * Merge a partial cache update into the store. Used by the action runner after a
   * successful action so feedback reflects the new state immediately.
   */
  async writeCache(patch: Partial<CacheState>): Promise<void> {
    await this.store.update((s) => {
      s.cache = { ...s.cache, ...patch };
    });
    // Signal subscribers (SSE, webhook) that state may have moved. They dedupe themselves.
    this.events?.emitChange();
  }

  /**
   * Lands metadata the operator set while idle onto the broadcast that actually went live.
   *
   * Fires exactly when the shape of the go-live bug appears: something is live now, it is not
   * the broadcast we wrote to, and a latched intent is still fresh. The replay is cleared
   * whether it succeeds or fails — a stuck latch would re-fire every refresh for the rest of the
   * show, which is far worse than one missed title.
   */
  private async replayPendingIfNeeded(
    previous: CacheState,
    target: { id: string; isLive: boolean },
  ): Promise<void> {
    const pending = previous.pendingMetadata;
    if (!pending || !this.replay) return;
    if (!target.isLive) return;
    // Not eligible, but still latched: disarm rather than leave it primed. Found in a live test —
    // a latch left armed after the broadcast we wrote to aired would replay this show's title
    // onto the next show started inside the TTL.
    if (!this.replayEligible(previous, target)) {
      await this.writeCache({ pendingMetadata: null });
      return;
    }
    await this.writeCache({ pendingMetadata: null });
    try {
      // null means the runner dropped the replay because a newer operator action already wrote to
      // the broadcast that aired. Nothing was applied, and nothing should be said about it.
      if ((await this.replay(pending)) === null) return;
      await this.adoptReplayedTarget(target.id, pending.payload.title ?? null);
      this.logger?.push({
        level: "info",
        category: "action",
        code: null,
        message: `YouTube started a new broadcast — re-applied your metadata${pending.payload.title ? ` (“${pending.payload.title}”)` : ""}`,
      });
    } catch (err) {
      const mapped = mapYouTubeError(err);
      // These two are rejected by the runner before it touches YouTube — the busy queue was full,
      // or the API is switched off. Nothing was written, so re-arm and let the next refresh try
      // again; only a failure that actually reached YouTube burns the latch.
      if (mapped.code === "BUSY_TRY_AGAIN" || mapped.code === "SERVICE_DISABLED") {
        // Only if nothing newer was latched while we were away. An action that ran meanwhile
        // arms its own latch describing the operator's current intent; writing the pre-failure
        // payload back over it would revert their edit on the next refresh.
        if (!this.snapshot().pendingMetadata) await this.writeCache({ pendingMetadata: pending });
        return;
      }
      this.logger?.push({
        level: "warn",
        category: categoryForCode(mapped.code),
        code: mapped.code,
        message: `Could not re-apply your metadata to the new broadcast: ${mapped.message}`,
      });
    }
  }

  /**
   * Moves the active preset onto the broadcast a replay just landed on, so later refreshes can go
   * back to reconciling it. Without this the preset would name a broadcast that is no longer the
   * target and stay lit forever, immune to the outside-edit check that is the whole point of
   * reconcileActivePreset.
   *
   * The replayed title is what is on air now: if it is not what the preset wrote (the latch
   * carried an ad-hoc edit, or no title at all), the preset is genuinely off air and drops.
   */
  private async adoptReplayedTarget(targetId: string, title: string | null): Promise<void> {
    const c = this.snapshot();
    if (!c.activePresetId || c.activePresetTitle === null) return;
    if (c.activePresetTitle.trim() !== (title ?? "").trim()) {
      await this.setActivePreset(null);
      return;
    }
    await this.setActivePreset(c.activePresetId, c.activePresetTitle, targetId);
  }

  /**
   * Whether a latched intent will actually be replayed onto `target`: something is live now, it
   * is not the broadcast we wrote to, and the latch is still fresh. Shared with runRefresh, which
   * has to know a replay is coming *before* it reconciles the active preset.
   */
  private replayEligible(previous: CacheState, target: { id: string; isLive: boolean }): boolean {
    const pending = previous.pendingMetadata;
    if (!pending || !this.replay) return false;
    if (!target.isLive) return false;
    if (target.id === pending.targetId) return false;
    return Date.parse(pending.capturedAt) >= Date.now() - PENDING_TTL_MS;
  }

  /**
   * Records which preset was last applied (PRD §5.4 active-preset feedback). `title` is the text
   * that preset actually wrote, kept so a later refresh can tell the preset is still what is on
   * air — see reconcileActivePreset.
   */
  async setActivePreset(
    presetId: string | null,
    title: string | null = null,
    targetId: string | null = null,
  ): Promise<void> {
    this.presetEpoch += 1;
    await this.writeCache({
      activePresetId: presetId,
      activePresetTitle: presetId ? title : null,
      activePresetTargetId: presetId ? targetId : null,
    });
  }

  /**
   * Drops the active preset when the live title no longer matches what that preset wrote.
   *
   * Every route through this app clears the active preset itself, but an edit made in YouTube
   * Studio (or the mobile app, or by a second operator) never reaches them — the preset key on
   * Companion stayed lit, and the slug image kept naming a preset that was no longer on air.
   * Returns the patch to fold into the caller's cache write rather than writing itself, so the
   * refresh still lands in a single store update.
   *
   * `epoch` is the preset generation observed before the refresh's GET. A refresh that started
   * before a preset was applied is carrying a title from before that write; comparing it would
   * clear the preset the operator just pressed, and — unlike the equally stale `status` in the
   * same patch — nothing later puts it back. A newer generation means "not my business, skip".
   *
   * `targetId` is the broadcast the title was read from. A different broadcast is not an outside
   * edit — it is a target switch, and the only thing that can say whether the preset survived it
   * is the pending replay (see adoptReplayedTarget). Only a title read from the very broadcast
   * the preset wrote to is evidence about that preset.
   */
  private reconcileActivePreset(
    title: string | null,
    epoch: number,
    targetId: string | null,
  ): Partial<CacheState> {
    if (epoch !== this.presetEpoch) return {};
    const c = this.snapshot();
    if (!c.activePresetId || c.activePresetTitle === null) return {};
    if (c.activePresetTargetId !== null && c.activePresetTargetId !== targetId) return {};
    // Trimmed on both sides: YouTube normalizes what it stores, so a title that came back with
    // surrounding whitespace stripped is the same title, not an edit made elsewhere.
    if (c.activePresetTitle.trim() === (title ?? "").trim()) return {};
    return { activePresetId: null, activePresetTitle: null, activePresetTargetId: null };
  }

  /** Stores the pre-change metadata so the last action can be undone. */
  async setUndoSnapshot(snapshot: CacheState["undoSnapshot"]): Promise<void> {
    await this.writeCache({ undoSnapshot: snapshot });
  }

  /** Arms (or clears) the intent to re-apply metadata onto whatever broadcast goes live next. */
  async setPendingMetadata(pending: CacheState["pendingMetadata"]): Promise<void> {
    await this.writeCache({ pendingMetadata: pending });
  }

  /**
   * Wires the replay callback after construction. The runner needs the cache and the cache needs
   * the runner, so the cycle is broken here rather than in either constructor.
   */
  setReplayHandler(replay: (pending: PendingMetadata) => Promise<unknown>): void {
    this.replay = replay;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
    // Kick off an immediate refresh so the cache is warm shortly after boot.
    void this.refresh();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * How long until the next poll, from the current snapshot. Public so the dashboard and tests
   * can see the cadence the timer is about to use without waiting for it to fire.
   */
  nextPollIntervalMs(): number {
    return pollIntervalMs(this.cadenceInput());
  }

  private cadenceInput(): CadenceInput {
    return {
      cache: this.snapshot(),
      apiEnabled: this.store.get().service.apiEnabled,
      normalIntervalMs: this.opts.refreshIntervalMs,
      now: Date.now(),
    };
  }

  /**
   * One tick of the poll loop: a cheap probe while a go-live is plausible, a full refresh
   * otherwise. Separated from the timer so the choice can be tested without waiting on one.
   */
  async pollOnce(): Promise<void> {
    if (!isFastWindow(this.cadenceInput())) return this.refresh();
    // The full refresh still runs on its normal interval — a probe is an extra look between
    // them, never a replacement for one. See lastFullRefreshStartedAt.
    if (Date.now() - this.lastFullRefreshStartedAt >= this.opts.refreshIntervalMs) {
      return this.refresh();
    }
    return this.probe();
  }

  /**
   * The fast tick. Asks one question — is anything active? — for 1 quota unit, against the 3–4 a
   * full refresh costs. A non-empty answer hands off to refresh(), which resolves the target
   * properly and drives PRD-12's replay; there is deliberately no targeting logic here.
   */
  private async probe(): Promise<void> {
    // The kill switch is already part of the cadence predicate, but probe() is reachable on its
    // own and "API off" must mean no YouTube call from any path.
    if (!this.store.get().service.apiEnabled) return;
    // A refresh already running asks a strictly better version of the same question. Probing
    // alongside it would spend a unit to learn something the in-flight run is about to write.
    if (this.inFlight) return this.inFlight;
    try {
      const active = await withTimeout(
        listBroadcasts(this.yt, { broadcastStatus: "active" }),
        REFRESH_TIMEOUT_MS,
      );
      if (active.length === 0) {
        // A probe that reached YouTube is the same evidence of a working connection that a
        // refresh is. Without this, health could only degrade for the whole fast window: one
        // blip would escalate to `offline` six times faster (failures now accrue every 10s) and
        // stay red until the window expired.
        await this.recordSuccess();
        return;
      }
    } catch (err) {
      // Same treatment as a failed refresh: the probe is a real API call, and a probe that
      // cannot reach YouTube is the same evidence about the connection that a refresh would be.
      await this.recordFailure(err);
      return;
    }
    await this.refresh();
  }

  /** Re-arms the single poll timer with the interval the current state calls for. */
  private scheduleNext(): void {
    if (!this.running) return;
    // Clear first: a stop()/start() cycle while a tick is awaiting an API call would otherwise
    // leave the old chain armed alongside the new one, doubling the poll rate for good.
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, this.nextPollIntervalMs());
  }

  /**
   * One scheduling path: every tick re-arms exactly one timer with the freshly-computed interval,
   * rather than switching between a fast and a slow `setInterval` that could both end up running.
   */
  private async tick(): Promise<void> {
    try {
      await this.pollOnce();
    } finally {
      this.scheduleNext();
    }
  }
}
