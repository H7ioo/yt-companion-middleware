import type { youtube_v3 } from "googleapis";
import type { JsonStore } from "../storage/jsonStore.js";
import type {
  PendingMetadata,
  PrivacyStatus,
  TargetConflict,
  UndoSnapshot,
} from "../storage/schema.js";
import { AppError } from "./errors.js";
import { applyPlan, getBroadcast, resolveTarget, toStatus } from "../youtube/broadcasts.js";
import { resolve, presetToPayload, type BroadcastResource, type MetadataPayload } from "./resolve.js";
import { resolvePresetText, type ResolvedVar } from "./template.js";
import type { StateCache } from "./stateCache.js";
import type { StateEvents } from "./events.js";
import { categoryForCode, levelForCode, type Logger } from "./logger.js";
import { mapYouTubeError } from "../youtube/client.js";

/**
 * A payload, or a function that builds one from the freshly-GET'd broadcast. The function
 * form lets actions like "toggle privacy" derive their target value from live state
 * without spending a second GET (PRD §6 read-modify-write already fetches once).
 */
type PayloadInput = MetadataPayload | ((current: BroadcastResource) => MetadataPayload);

/** private <-> public toggle. unlisted counts as "visible", so it flips to private. */
export function togglePrivacy(current: PrivacyStatus | string | null | undefined): PrivacyStatus {
  return current === "private" ? "public" : "private";
}

const PRIVACY_VALUES: readonly string[] = ["public", "unlisted", "private"];

/**
 * Extracts the owned metadata fields from a live broadcast into an undo payload. Category
 * lives on the video resource (not fetched here), so undo restores title/description/
 * privacy/stream-binding and leaves category untouched.
 */
export function snapshotOf(current: BroadcastResource): UndoSnapshot {
  const privacy = current.status?.privacyStatus;
  const boundStreamId = current.contentDetails?.boundStreamId;
  return {
    payload: {
      title: current.snippet?.title ?? undefined,
      description: current.snippet?.description ?? undefined,
      privacyStatus:
        typeof privacy === "string" && PRIVACY_VALUES.includes(privacy)
          ? (privacy as PrivacyStatus)
          : undefined,
      streamBoundId: typeof boundStreamId === "string" ? boundStreamId : undefined,
    },
    label: (current.snippet?.title as string | undefined) ?? null,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Narrows a payload to the fields worth replaying onto a broadcast YouTube minted after the
 * fact. Stream binding is excluded (the encoder is already feeding the live broadcast by then);
 * a payload carrying none of these latches nothing.
 */
export function pendingFrom(payload: MetadataPayload, targetId: string): PendingMetadata | null {
  const carried = {
    title: payload.title,
    description: payload.description,
    privacyStatus: payload.privacyStatus,
    category: payload.category,
  };
  const hasIntent = Object.values(carried).some((v) => v !== undefined);
  if (!hasIntent) return null;
  return { payload: carried, targetId, capturedAt: new Date().toISOString() };
}

/**
 * Folds a new idle action into whatever intent is already latched for the same broadcast.
 *
 * The latch has to describe the ghost broadcast's *final* owned state, not the last action's
 * fields: set a title, then flip privacy, and a wholesale replace would drop the title — the
 * replay would then land privacy on the broadcast that airs and leave YouTube's default title
 * on screen. A narrower action only overwrites the fields it actually carries.
 *
 * A different target means a different broadcast holds those earlier fields, so nothing is
 * carried over — the new action starts the latch fresh.
 */
export function mergePending(
  existing: PendingMetadata | null | undefined,
  payload: MetadataPayload,
  targetId: string,
): PendingMetadata | null {
  const next = pendingFrom(payload, targetId);
  // An action carrying none of the replayable fields (a bare stream re-bind) says nothing about
  // the latched intent, so it leaves it standing rather than disarming it. This holds whichever
  // broadcast it ran against: a re-bind on some other target is still no reason to drop a title
  // the operator set for tonight.
  if (!next) return existing ?? null;
  if (!existing || existing.targetId !== targetId) return next;
  return {
    ...next,
    payload: {
      ...existing.payload,
      ...Object.fromEntries(Object.entries(next.payload).filter(([, v]) => v !== undefined)),
    },
  };
}

export interface ActionResult {
  status: { title: string | null; privacyStatus: string | null; isLive: boolean };
  target: { id: string; isLive: boolean };
  /** Present on preset actions: how each template variable resolved (PRD §4). */
  resolvedVars?: ResolvedVar[];
}

/**
 * Serializes actions with a single global busy flag and a depth-1 queue (PRD §5.5).
 * At most one action runs at a time; at most one may wait. A third concurrent request
 * is rejected with BUSY_TRY_AGAIN.
 */
export class ActionRunner {
  private busy = false;
  private queued: (() => void) | null = null;
  /**
   * When an operator action last landed a write on YouTube. Read only by replayPending, to tell
   * "my latched payload is still the newest thing the operator asked for" from "they have edited
   * since". Replays do not update it — a replay is the resolution of an older intent, never a
   * newer one.
   */
  private lastAppliedAt: number | null = null;

  constructor(
    private readonly yt: youtube_v3.Youtube,
    private readonly store: JsonStore,
    private readonly cache: StateCache,
    private readonly events?: StateEvents,
    private readonly logger?: Logger,
  ) {}

  isBusy(): boolean {
    return this.busy;
  }

  /**
   * Rejects — before any YouTube call — when the operator has switched the API off from the
   * dashboard, so an idle service never spends quota on a stray Companion button press.
   */
  private assertEnabled(): void {
    if (!this.store.get().service.apiEnabled) throw new AppError("SERVICE_DISABLED");
  }

  /** Set the busy flag and push a change so the "processing" indicator updates promptly. */
  private setBusy(value: boolean): void {
    if (this.busy === value) return;
    this.busy = value;
    this.events?.emitChange();
  }

  /**
   * Applies a preset by id (PRD §5.3 /action/preset). Optional `vars` fill in `{name}`
   * template variables in the preset title/description (PRD §1-2). Rejects with
   * MISSING_TEMPLATE_VARS — before any YouTube call — when a field has an unresolved
   * variable and no fallback text.
   */
  async runPreset(presetId: string, vars: Record<string, string> = {}): Promise<ActionResult> {
    this.assertEnabled();
    const preset = this.store.get().presets.find((p) => p.id === presetId);
    if (!preset) throw new AppError("INVALID_PRESET", `Preset '${presetId}' not found`);
    const resolved = resolvePresetText(preset, vars);
    if (resolved.missing.length > 0) {
      throw new AppError(
        "MISSING_TEMPLATE_VARS",
        `Unresolved template variables: ${resolved.missing.join(", ")}`,
      );
    }
    return this.enqueue(async () => {
      const payload = presetToPayload(preset);
      payload.title = resolved.title;
      payload.description = resolved.description;
      const result = await this.applyPayload(payload);
      // The title this action actually put on the broadcast, templates resolved — taken from the
      // merged plan (what we sent), since the PUT response is not read back. A refresh compares
      // against it to notice the metadata being changed outside this app; the comparison trims,
      // so YouTube normalizing the stored value is not mistaken for such an edit.
      // The target id goes on record too: it scopes the reconcile to the broadcast this preset
      // actually wrote to, so a target switch (an auto-start mint, a transient empty list) is not
      // mistaken for the metadata being changed outside the app.
      await this.cache.setActivePreset(
        presetId,
        result.status.title ?? resolved.title,
        result.target.id,
      );
      return { ...result, resolvedVars: resolved.resolvedVars };
    });
  }

  /** Applies an ad-hoc payload (PRD §5.3 /action/update). Clears active preset. */
  async runUpdate(payload: MetadataPayload): Promise<ActionResult> {
    this.assertEnabled();
    return this.enqueue(async () => {
      const result = await this.applyPayload(payload);
      await this.cache.setActivePreset(null);
      return result;
    });
  }

  /**
   * Sets or toggles only the privacy status, leaving every other owned field on the
   * current target untouched. `status` sets an explicit value; when omitted, the current
   * privacy is flipped private <-> public. Clears the active preset because the state now
   * diverges from whatever preset was applied.
   */
  async runPrivacy(arg: { status?: PrivacyStatus }): Promise<ActionResult> {
    this.assertEnabled();
    return this.enqueue(async () => {
      const result = await this.applyPayload(
        (current) => ({
          privacyStatus: arg.status ?? togglePrivacy(current.status?.privacyStatus),
        }),
        // A privacy flip must not silently re-apply the default category or re-bind the
        // default stream mid-broadcast — touch privacy only.
        { skipDefaults: true },
      );
      await this.cache.setActivePreset(null);
      return result;
    });
  }

  /**
   * Restores the metadata captured before the most recent change (PRD feature: undo).
   * Recovers a misfired ad-hoc update or preset on a live stream. Throws NO_UNDO_AVAILABLE
   * if nothing has been changed yet. Clears the active preset since state now diverges.
   */
  async runUndo(): Promise<ActionResult> {
    this.assertEnabled();
    const snapshot = this.store.get().cache.undoSnapshot;
    if (!snapshot) throw new AppError("NO_UNDO_AVAILABLE");
    return this.enqueue(async () => {
      // skipDefaults so undo restores exactly the captured values and doesn't re-inject
      // the app-default category/stream.
      const result = await this.applyPayload(snapshot.payload, { skipDefaults: true });
      await this.cache.setActivePreset(null);
      return result;
    });
  }

  /**
   * Re-applies metadata that was set while idle onto the broadcast that actually went live
   * (PRD-12 §2). Called by the state cache the moment it sees a live broadcast whose id differs
   * from the one the operator wrote to — the "set the title, then go live" fix.
   *
   * `skipDefaults` because this replays a specific captured intent: the app default category and
   * stream binding were already resolved when the operator applied it, and re-binding a stream
   * that is mid-broadcast would cut the feed.
   *
   * Returns null when the replay was superseded and nothing was written.
   */
  async replayPending(pending: PendingMetadata): Promise<ActionResult | null> {
    this.assertEnabled();
    return this.enqueue(async () => {
      // The replay queues behind operator actions, so by the time it runs an action that started
      // moments earlier may already have written newer metadata to the broadcast that aired.
      // Writing the older latched payload on top would silently revert that edit — precisely when
      // the operator is fixing what is on screen. Their newer intent wins; the latch is already
      // cleared by the caller either way.
      if (this.lastAppliedAt !== null && this.lastAppliedAt > Date.parse(pending.capturedAt)) {
        return null;
      }
      return this.applyPayload(pending.payload, { skipDefaults: true, replay: true });
    });
  }

  /** A drift conflict already on the cache, which only a later refresh can clear. */
  private keptDrift(): TargetConflict | null {
    const existing = this.store.get().cache.targetConflict;
    return existing?.code === "TARGET_DRIFT" ? existing : null;
  }

  /** The GET -> merge -> PUT pipeline (PRD §3.3, §6). */
  private async applyPayload(
    input: PayloadInput,
    opts: { skipDefaults?: boolean; replay?: boolean } = {},
  ): Promise<ActionResult> {
    try {
      // autoStartMint is a refresh-time signal (see stateCache.driftConflict); dropped here so
      // the action result stays the {id, isLive} pair the API contract promises.
      const { conflict, autoStartMint: _mint, ...target } = await resolveTarget(this.yt);
      const current = await getBroadcast(this.yt, target.id);
      const payload = typeof input === "function" ? input(current as BroadcastResource) : input;
      // Capture the current owned fields so the last change can be undone (PRD feature: undo).
      await this.cache.setUndoSnapshot(snapshotOf(current as BroadcastResource));
      // skipDefaults suppresses the app-default fallback for category/stream binding (an
      // explicit payload value still wins) — so a targeted action like privacy-toggle or
      // undo doesn't drag in the default category/stream it never meant to touch.
      const defaults = opts.skipDefaults
        ? { defaultCategory: null, defaultStreamBoundId: null }
        : this.store.get().defaults;
      const plan = resolve(current as BroadcastResource, payload, defaults);
      await applyPlan(this.yt, plan);
      // Stamped before the latch is armed below, so the latch this very action creates always
      // carries the later timestamp and is never mistaken for superseded by its own action.
      if (!opts.replay) this.lastAppliedAt = Date.now();

      // Applying while idle writes to a broadcast that may not be the one YouTube ends up
      // airing, so remember the intent — but only once the write actually landed. Arming ahead
      // of applyPlan meant a YouTube-rejected edit still got replayed onto the next broadcast
      // to go live. A replay is itself the resolution of an earlier latch and must not re-arm
      // it, or a channel that keeps minting broadcasts would loop.
      if (!target.isLive && !opts.replay) {
        const existing = this.store.get().cache.pendingMetadata;
        await this.cache.setPendingMetadata(mergePending(existing, payload, target.id));
      }

      const status = { ...toStatus(plan.broadcast), noTarget: false };
      await this.cache.writeCache({
        status,
        lastRefreshedAt: new Date().toISOString(),
        // resolveTarget only ever reports ambiguity among the broadcasts it can see; it never
        // reports drift, which is the cache comparing refreshes over time. Writing its answer
        // straight through would clear a live TARGET_DRIFT banner just because the operator
        // pressed a preset key — the stray broadcasts would still be there.
        targetConflict: conflict ?? this.keptDrift(),
        lastTargetId: target.id,
        // Landing on the live broadcast is the end of the road for any latched intent.
        ...(target.isLive ? { pendingMetadata: null } : {}),
      });
      this.logger?.push({
        level: "info",
        category: "action",
        code: null,
        message: `Updated broadcast${status.title ? ` — “${status.title}”` : ""}`,
      });
      return { status, target };
    } catch (err) {
      // Surface the failure on the activity feed under the category that caused it (an auth/
      // network/quota write failure lands in that lane; anything else is a generic action error).
      const mapped = mapYouTubeError(err);
      this.logger?.push({
        level: levelForCode(mapped.code),
        category: mapped.code === "YOUTUBE_ERROR" ? "action" : categoryForCode(mapped.code),
        code: mapped.code,
        message: `Action failed: ${mapped.message}`,
      });
      throw err;
    }
  }

  /**
   * Runs `task` under the busy flag. If busy and the queue slot is free, waits for the
   * current task to finish then runs. If busy and already queued, rejects immediately.
   *
   * The busy flag is *held across the handoff* to the queued waiter — it is only
   * cleared when there is no waiter. This prevents a fresh request from slipping into
   * the gap while the queued continuation is still a pending microtask.
   */
  private async enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.busy) {
      if (this.queued) throw new AppError("BUSY_TRY_AGAIN");
      // Wait for the in-flight task to signal us. busy remains true throughout.
      await new Promise<void>((resolve) => {
        this.queued = resolve;
      });
    } else {
      this.setBusy(true);
    }
    try {
      return await task();
    } finally {
      const next = this.queued;
      this.queued = null;
      if (next) {
        // Hand the (still-held) busy flag to the waiter.
        next();
      } else {
        this.setBusy(false);
      }
    }
  }
}
