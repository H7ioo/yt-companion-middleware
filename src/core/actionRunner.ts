import type { youtube_v3 } from "googleapis";
import type { JsonStore } from "../storage/jsonStore.js";
import type { PrivacyStatus, UndoSnapshot } from "../storage/schema.js";
import { AppError } from "./errors.js";
import { applyPlan, getBroadcast, resolveTarget, toStatus } from "../youtube/broadcasts.js";
import { resolve, presetToPayload, type BroadcastResource, type MetadataPayload } from "./resolve.js";
import { resolvePresetText, type ResolvedVar } from "./template.js";
import type { StateCache } from "./stateCache.js";
import type { StateEvents } from "./events.js";

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

  constructor(
    private readonly yt: youtube_v3.Youtube,
    private readonly store: JsonStore,
    private readonly cache: StateCache,
    private readonly events?: StateEvents,
  ) {}

  isBusy(): boolean {
    return this.busy;
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
      await this.cache.setActivePreset(presetId);
      return { ...result, resolvedVars: resolved.resolvedVars };
    });
  }

  /** Applies an ad-hoc payload (PRD §5.3 /action/update). Clears active preset. */
  async runUpdate(payload: MetadataPayload): Promise<ActionResult> {
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

  /** The GET -> merge -> PUT pipeline (PRD §3.3, §6). */
  private async applyPayload(
    input: PayloadInput,
    opts: { skipDefaults?: boolean } = {},
  ): Promise<ActionResult> {
    const target = await resolveTarget(this.yt);
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

    const status = { ...toStatus(plan.broadcast), noTarget: false };
    await this.cache.writeCache({ status, lastRefreshedAt: new Date().toISOString() });
    return { status, target };
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
