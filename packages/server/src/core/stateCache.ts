import type { youtube_v3 } from "googleapis";
import type { JsonStore } from "../storage/jsonStore.js";
import type { CacheState } from "../storage/schema.js";
import { getBroadcast, resolveTarget, toStatus } from "../youtube/broadcasts.js";
import { isAuthError, isNetworkError, mapYouTubeError } from "../youtube/client.js";
import { initialHealth, onFailure, onSuccess, type HealthState } from "./health.js";
import type { StateEvents } from "./events.js";

/**
 * Holds the state served to Companion feedback endpoints (PRD §5.4). All feedback reads
 * come from here, never a live YouTube call, so Companion polling costs zero quota.
 *
 * The cache is refreshed automatically after every successful action, plus a background
 * timer every `refreshIntervalMs` to catch out-of-band changes (e.g. a stream ended from
 * YouTube Studio).
 */
export class StateCache {
  private health: HealthState = initialHealth();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly yt: youtube_v3.Youtube,
    private readonly store: JsonStore,
    private readonly opts: { refreshIntervalMs: number; healthFailureThreshold: number },
    private readonly events?: StateEvents,
  ) {}

  /** Current cache snapshot from the store. */
  snapshot(): CacheState {
    return this.store.get().cache;
  }

  /** Perform a live GET and repopulate the cache. Updates health on success/failure. */
  async refresh(): Promise<void> {
    // Master switch off: make no YouTube call. The background timer keeps ticking so polling
    // resumes the instant the operator re-enables the API, but while off it costs zero quota.
    if (!this.store.get().service.apiEnabled) return;
    try {
      const target = await resolveTarget(this.yt);
      const broadcast = await getBroadcast(this.yt, target.id);
      const status = toStatus(broadcast);
      this.health = onSuccess(this.health);
      await this.writeCache({
        status: { ...status, noTarget: false },
        health: "ok",
        healthMessage: null,
        lastRefreshedAt: new Date().toISOString(),
      });
    } catch (err) {
      const mapped = mapYouTubeError(err);
      // An idle channel with no active/persistent broadcast is an expected state, not a
      // health failure. Keep health green and flag it as "no target" rather than
      // escalating toward auth_error (PRD §5.4 is about API failures, not empty results).
      if (mapped.code === "NO_TARGET_FOUND") {
        this.health = onSuccess(this.health);
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

  /** Records which preset was last applied (PRD §5.4 active-preset feedback). */
  async setActivePreset(presetId: string | null): Promise<void> {
    await this.writeCache({ activePresetId: presetId });
  }

  /** Stores the pre-change metadata so the last action can be undone. */
  async setUndoSnapshot(snapshot: CacheState["undoSnapshot"]): Promise<void> {
    await this.writeCache({ undoSnapshot: snapshot });
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
