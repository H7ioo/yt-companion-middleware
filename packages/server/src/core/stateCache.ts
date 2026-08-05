import type { youtube_v3 } from "googleapis";
import type { JsonStore } from "../storage/jsonStore.js";
import type { CacheState, PendingMetadata, TargetConflict } from "../storage/schema.js";
import { getBroadcast, resolveTarget, toStatus } from "../youtube/broadcasts.js";
import { isAuthError, isNetworkError, mapYouTubeError } from "../youtube/client.js";
import { initialHealth, onFailure, onSuccess, type HealthState } from "./health.js";
import type { StateEvents } from "./events.js";
import { categoryForCode, levelForCode, type Logger } from "./logger.js";

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
 * The target changed while we were idle and nothing else explained it — something outside this
 * app (almost always YouTube Studio) is creating broadcasts. Reported only when idle: once live,
 * the active broadcast is authoritative and a change of id is just the show starting.
 */
function driftConflict(
  previous: CacheState,
  target: { id: string; isLive: boolean },
): TargetConflict | null {
  if (target.isLive || !previous.lastTargetId || previous.lastTargetId === target.id) return null;
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
  /** Set post-construction via setReplayHandler — see the note there on the runner/cache cycle. */
  private replay: ((pending: PendingMetadata) => Promise<unknown>) | null = null;

  constructor(
    private readonly yt: youtube_v3.Youtube,
    private readonly store: JsonStore,
    private readonly opts: { refreshIntervalMs: number; healthFailureThreshold: number },
    private readonly events?: StateEvents,
    private readonly logger?: Logger,
  ) {}

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

  /** Perform a live GET and repopulate the cache. Updates health on success/failure. */
  async refresh(): Promise<void> {
    // Master switch off: make no YouTube call. The background timer keeps ticking so polling
    // resumes the instant the operator re-enables the API, but while off it costs zero quota.
    if (!this.store.get().service.apiEnabled) return;
    const wasUnhealthy = this.health.status !== "ok";
    try {
      const { conflict, ...target } = await resolveTarget(this.yt);
      const broadcast = await getBroadcast(this.yt, target.id);
      const status = toStatus(broadcast);
      this.health = onSuccess(this.health);
      this.logRecovery(wasUnhealthy);
      const previous = this.snapshot();
      await this.writeCache({
        status: { ...status, noTarget: false },
        health: "ok",
        healthMessage: null,
        lastRefreshedAt: new Date().toISOString(),
        targetConflict: conflict ?? driftConflict(previous, target),
        lastTargetId: target.id,
      });
      // Ordered after the cache write so the dashboard reflects the live broadcast even if the
      // replay itself fails; the replay writes the cache again on success.
      await this.replayPendingIfNeeded(previous, target);
    } catch (err) {
      const mapped = mapYouTubeError(err);
      // An idle channel with no active/persistent broadcast is an expected state, not a
      // health failure. Keep health green and flag it as "no target" rather than
      // escalating toward auth_error (PRD §5.4 is about API failures, not empty results).
      if (mapped.code === "NO_TARGET_FOUND") {
        this.health = onSuccess(this.health);
        this.logRecovery(wasUnhealthy);
        await this.writeCache({
          status: { title: null, privacyStatus: null, isLive: false, noTarget: true },
          health: "ok",
          healthMessage: null,
          lastRefreshedAt: new Date().toISOString(),
        });
        return;
      }
      const kind = isAuthError(mapped) ? "auth" : isNetworkError(mapped) ? "network" : "transient";
      this.health = onFailure(this.health, {
        kind,
        threshold: this.opts.healthFailureThreshold,
        message: mapped.message,
      });
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
    // The broadcast we wrote to is the one that aired: the intent is already satisfied, so disarm
    // rather than leave it primed. Found in a live test — a latch left armed here would replay
    // this show's title onto the next show started inside the TTL.
    if (target.id === pending.targetId) {
      await this.writeCache({ pendingMetadata: null });
      return;
    }
    if (Date.parse(pending.capturedAt) < Date.now() - PENDING_TTL_MS) {
      await this.writeCache({ pendingMetadata: null });
      return;
    }
    await this.writeCache({ pendingMetadata: null });
    try {
      await this.replay(pending);
      this.logger?.push({
        level: "info",
        category: "action",
        code: null,
        message: `YouTube started a new broadcast — re-applied your metadata${pending.payload.title ? ` (“${pending.payload.title}”)` : ""}`,
      });
    } catch (err) {
      const mapped = mapYouTubeError(err);
      this.logger?.push({
        level: "warn",
        category: categoryForCode(mapped.code),
        code: mapped.code,
        message: `Could not re-apply your metadata to the new broadcast: ${mapped.message}`,
      });
    }
  }

  /** Records which preset was last applied (PRD §5.4 active-preset feedback). */
  async setActivePreset(presetId: string | null): Promise<void> {
    await this.writeCache({ activePresetId: presetId });
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
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.opts.refreshIntervalMs);
    // Kick off an immediate refresh so the cache is warm shortly after boot.
    void this.refresh();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
