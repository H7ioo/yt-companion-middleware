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

export const healthStatusSchema = z.enum(["ok", "degraded", "auth_error"]);
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
  undoSnapshot: undoSnapshotSchema.nullable().default(null),
  health: healthStatusSchema.default("ok"),
  healthMessage: z.string().nullable().default(null),
  lastRefreshedAt: z.string().nullable().default(null),
});
export type CacheState = z.infer<typeof cacheSchema>;

/** Persisted daily YouTube quota counter (cost-weighted units, PT reset). */
export const quotaSchema = z.object({
  date: z.string().nullable().default(null),
  used: z.number().default(0),
});
export type QuotaState = z.infer<typeof quotaSchema>;

/** Outbound webhook config — POST the state to this URL on every meaningful change. */
export const webhookSchema = z.object({
  url: z.string().url().nullable().default(null),
});
export type WebhookState = z.infer<typeof webhookSchema>;

/**
 * Master API switch (dashboard kill-switch). When `apiEnabled` is false the middleware
 * makes no YouTube calls at all — the background poll idles and every action is rejected —
 * so an idle service (with Companion still polling) stops burning YouTube quota.
 */
export const serviceSchema = z.object({
  apiEnabled: z.boolean().default(true),
});
export type ServiceState = z.infer<typeof serviceSchema>;

export const storeSchema = z.object({
  presets: z.array(presetSchema).default([]),
  defaults: defaultSettingsSchema.default({
    defaultCategory: null,
    defaultStreamBoundId: null,
  }),
  quota: quotaSchema.default({ date: null, used: 0 }),
  webhook: webhookSchema.default({ url: null }),
  service: serviceSchema.default({ apiEnabled: true }),
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
