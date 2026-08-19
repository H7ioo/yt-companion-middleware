import { z } from "zod";

export const privacyStatusSchema = z.enum(["public", "unlisted", "private"]);
export type PrivacyStatus = z.infer<typeof privacyStatusSchema>;

/**
 * A preset. `title`, `description`, `privacyStatus` are always defined.
 * `category` and `streamBoundId` are optional overrides — null means "inherit
 * the app-level default" (PRD §3.2).
 */
export const presetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  // Short display label shown on Companion buttons instead of the (often Arabic) title, which
  // Companion's bundled fonts render as tofu boxes. Free text — may itself be Arabic, in which
  // case the slug PNG carries it. Empty falls back to the preset id on the button (PRD §5.4).
  slug: z.string().default(""),
  description: z.string().default(""),
  privacyStatus: privacyStatusSchema,
  category: z.string().min(1).nullable().default(null),
  streamBoundId: z.string().min(1).nullable().default(null),
  // Whole-sentence fallbacks (PRD §1) used when a field has any unresolved variable.
  // Optional + nullable so presets and backups saved before templating still parse.
  titleFallback: z.string().nullable().default(null),
  descriptionFallback: z.string().nullable().default(null),
});
export type Preset = z.infer<typeof presetSchema>;

/** App-level default settings — the baseline fallback for every update (PRD §3.1). */
export const defaultSettingsSchema = z.object({
  defaultCategory: z.string().min(1).nullable().default(null),
  defaultStreamBoundId: z.string().min(1).nullable().default(null),
});
export type DefaultSettings = z.infer<typeof defaultSettingsSchema>;

export const healthStatusSchema = z.enum(["ok", "degraded", "offline", "auth_error"]);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

/**
 * The owned metadata captured before the most recent change, so it can be restored via
 * /api/action/undo. Category is not captured (it lives on the video resource, not the
 * broadcast GET), so undo leaves category untouched.
 */
export const undoSnapshotSchema = z.object({
  payload: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    privacyStatus: privacyStatusSchema.optional(),
    streamBoundId: z.string().optional(),
  }),
  /** Title of the state being replaced — shown on the dashboard's undo affordance. */
  label: z.string().nullable().default(null),
  capturedAt: z.string(),
});
export type UndoSnapshot = z.infer<typeof undoSnapshotSchema>;

/**
 * A warning that the broadcast we are editing may not be the one that goes to air. Kept
 * separate from `health` on purpose: health answers "can we reach YouTube", this answers "are
 * we pointed at the right thing". A channel can be perfectly healthy and still ambiguous —
 * which is exactly the state that makes a pre-live title change silently do nothing.
 */
export const targetConflictSchema = z.object({
  code: z.enum([
    "SHARED_STREAM_KEY",
    "MULTIPLE_UPCOMING",
    "TARGET_DRIFT",
    "PINNED_TARGET_GONE",
  ]),
  message: z.string(),
  ids: z.array(z.string()).default([]),
});
export type TargetConflict = z.infer<typeof targetConflictSchema>;

/**
 * Metadata applied while idle, held so it can be re-applied if YouTube goes live on a
 * *different* broadcast than the one we wrote to.
 *
 * This is the fix for "set the title, then go live, and nothing happened": with an auto-start
 * encoder YouTube mints the broadcast that actually airs roughly a minute before air, so at the
 * moment the operator sets the title the real target does not exist yet. Rather than ask them to
 * re-apply mid-show, we remember the intent and land it once the real broadcast appears.
 *
 * `streamBoundId` is deliberately not carried: by the time this replays, the encoder is already
 * feeding the live broadcast and re-binding would interrupt it.
 */
export const pendingMetadataSchema = z.object({
  payload: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    privacyStatus: privacyStatusSchema.optional(),
    category: z.string().nullable().optional(),
  }),
  /** The broadcast this was written to. A live broadcast with a different id triggers the replay. */
  targetId: z.string(),
  capturedAt: z.string(),
});
export type PendingMetadata = z.infer<typeof pendingMetadataSchema>;

/** Cached status/health state served to Companion feedback endpoints (PRD §5.4). */
export const cacheSchema = z.object({
  status: z
    .object({
      title: z.string().nullable(),
      privacyStatus: z.string().nullable(),
      isLive: z.boolean(),
      // True when the channel has no active or persistent broadcast (idle, not an error).
      noTarget: z.boolean().default(false),
    })
    .default({ title: null, privacyStatus: null, isLive: false, noTarget: false }),
  activePresetId: z.string().nullable().default(null),
  /**
   * The title the active preset actually wrote (templates already resolved). A refresh compares
   * it against what YouTube reports: once they diverge the metadata was changed somewhere else —
   * YouTube Studio, the mobile app, another operator — so the preset is no longer what is on air
   * and its Companion highlight has to drop. Null means "don't reconcile" (nothing applied, or a
   * store written before this field existed).
   */
  activePresetTitle: z.string().nullable().default(null),
  /**
   * The broadcast `activePresetTitle` was written to. The title comparison above is only evidence
   * of an outside edit when it reads *the same broadcast the preset wrote to*: with an auto-start
   * encoder YouTube mints a fresh broadcast about a minute before air (PRD-12 §2), and reconciling
   * the preset against that new broadcast's placeholder title would drop it while the pending
   * replay is still on its way to landing the preset's own metadata there. Null means "don't
   * reconcile by target" (a store written before this field existed).
   */
  activePresetTargetId: z.string().nullable().default(null),
  undoSnapshot: undoSnapshotSchema.nullable().default(null),
  health: healthStatusSchema.default("ok"),
  healthMessage: z.string().nullable().default(null),
  lastRefreshedAt: z.string().nullable().default(null),
  targetConflict: targetConflictSchema.nullable().default(null),
  pendingMetadata: pendingMetadataSchema.nullable().default(null),
  /** Id of the last resolved target, so a change while idle can be spotted as drift. */
  lastTargetId: z.string().nullable().default(null),
});
export type CacheState = z.infer<typeof cacheSchema>;

/** Persisted daily YouTube quota counter (cost-weighted units, PT reset). */
export const quotaSchema = z.object({
  date: z.string().nullable().default(null),
  used: z.number().default(0),
});
export type QuotaState = z.infer<typeof quotaSchema>;

/**
 * Phone-push config for the Companion fill flow: when `ntfyTopic` is set, every fill request is
 * also pushed to `<ntfyServer>/<ntfyTopic>` as a tap-to-open notification carrying the `/fill`
 * deep link — so a locked phone with the ntfy app can still receive the fill page. Empty topic
 * disables the push. `publicBaseUrl` is the base the *phone* can reach (e.g. the Tailscale
 * hostname); empty falls back to the host the request arrived on.
 */
export const notifySchema = z.object({
  ntfyServer: z.string().url().default("https://ntfy.sh"),
  ntfyTopic: z.string().default(""),
  publicBaseUrl: z.string().default(""),
});
export type NotifyState = z.infer<typeof notifySchema>;

/** Outbound webhook config — POST the state to this URL on every meaningful change. */
export const webhookSchema = z.object({
  url: z.string().url().nullable().default(null),
});
export type WebhookState = z.infer<typeof webhookSchema>;

/**
 * The broadcast the operator explicitly chose to edit.
 *
 * Everything else in target resolution is inference: list the channel's broadcasts and rank them
 * by how much they look like the one going to air. The ranking is good, but it is still a guess,
 * and on a channel carrying strays it is a guess made among candidates the operator can see and
 * we cannot distinguish. A pin replaces the guess with their answer for as long as it holds.
 *
 * It is deliberately not a "default": defaults describe what to write, this describes where. It
 * also never outranks a live broadcast — once the encoder is feeding one, that is what is on air
 * regardless of what was pinned, and PRD-12's latch is what carries the metadata across.
 */
export const targetPinSchema = z.object({
  id: z.string().min(1),
  /** Title as it read when pinned, so the dashboard can name the target without a fetch. */
  label: z.string().nullable().default(null),
  pinnedAt: z.string(),
});
export type TargetPin = z.infer<typeof targetPinSchema>;

/**
 * Master API switch (dashboard kill-switch). When `apiEnabled` is false the middleware
 * makes no YouTube calls at all — the background poll idles and every action is rejected —
 * so an idle service (with Companion still polling) stops burning YouTube quota.
 */
export const serviceSchema = z.object({
  apiEnabled: z.boolean().default(true),
});
export type ServiceState = z.infer<typeof serviceSchema>;

/**
 * YouTube OAuth credentials entered through the desktop setup screen. Persisted here so the
 * app can be configured without editing a .env file. Empty strings mean "not set" — when any
 * is empty the app falls back to the matching environment variable, and if still empty it boots
 * in setup mode. The refresh token never leaves the server (never sent to a client endpoint).
 */
export const credentialsSchema = z.object({
  clientId: z.string().default(""),
  clientSecret: z.string().default(""),
  refreshToken: z.string().default(""),
});
export type CredentialsState = z.infer<typeof credentialsSchema>;

export const storeSchema = z.object({
  credentials: credentialsSchema.default({ clientId: "", clientSecret: "", refreshToken: "" }),
  presets: z.array(presetSchema).default([]),
  defaults: defaultSettingsSchema.default({
    defaultCategory: null,
    defaultStreamBoundId: null,
  }),
  quota: quotaSchema.default({ date: null, used: 0 }),
  webhook: webhookSchema.default({ url: null }),
  notify: notifySchema.default({ ntfyServer: "https://ntfy.sh", ntfyTopic: "", publicBaseUrl: "" }),
  service: serviceSchema.default({ apiEnabled: true }),
  targetPin: targetPinSchema.nullable().default(null),
  cache: cacheSchema.default({
    status: { title: null, privacyStatus: null, isLive: false, noTarget: false },
    activePresetId: null,
    health: "ok",
    healthMessage: null,
    lastRefreshedAt: null,
  }),
});
export type Store = z.infer<typeof storeSchema>;

export function emptyStore(): Store {
  return storeSchema.parse({});
}
