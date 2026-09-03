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

/**
 * What YouTube says it is seeing on one ingestion key, read from `liveStreams.list` (issue 059).
 *
 * The raw values are carried rather than the resolved state: the classification is a pure function
 * in the shared glossary ({@link describeIngestion}), and persisting its *output* would freeze
 * yesterday's mapping into the store the first time that function is corrected.
 */
export const ingestionSnapshotSchema = z.object({
  /** The key this reading is about — a reading is meaningless without it. */
  streamId: z.string(),
  streamTitle: z.string().nullable().default(null),
  /** `status.streamStatus`: active | created | error | inactive | ready. */
  streamStatus: z.string().nullable().default(null),
  /** `status.healthStatus.status`: good | ok | bad | noData. */
  healthStatus: z.string().nullable().default(null),
  /** YouTube's own configuration complaints, verbatim — the actionable half of "problems". */
  issues: z
    .array(
      z.object({
        severity: z.string().nullable().default(null),
        reason: z.string().nullable().default(null),
        description: z.string().nullable().default(null),
      }),
    )
    .default([]),
  /** When this reading was taken. A stale reading is still worth showing — labelled as stale. */
  checkedAt: z.string(),
});
export type IngestionSnapshot = z.infer<typeof ingestionSnapshotSchema>;

/** Cached status/health state served to Companion feedback endpoints (PRD §5.4). */
export const cacheSchema = z.object({
  status: z
    .object({
      /**
       * The broadcast this status describes, or null when there is none. A watch or Studio link
       * is built from it (issue 065); null the moment the channel goes idle, because a link to
       * last night's show reads as this evening's.
       */
      broadcastId: z.string().nullable().default(null),
      title: z.string().nullable(),
      privacyStatus: z.string().nullable(),
      isLive: z.boolean(),
      // True when the channel has no active or persistent broadcast (idle, not an error).
      noTarget: z.boolean().default(false),
    })
    .default({
      broadcastId: null,
      title: null,
      privacyStatus: null,
      isLive: false,
      noTarget: false,
    }),
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
  /**
   * The last ingestion reading for the default ingestion key (issue 059), or null when none has
   * been taken. Cached rather than read per request so the Companion feedback keeps the zero-quota
   * promise every other feedback makes — the poll loop refreshes it, and only when it can matter.
   */
  ingestion: ingestionSnapshotSchema.nullable().default(null),
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

/**
 * A person with access to this deployment (PRD-15 §2, issue 043).
 *
 * `role` is enforced as of issue 045: an admin manages people, roles and the YouTube connection,
 * and a user runs the show. The dividing line is PRD-15 §1's — if getting it wrong means a bad
 * stream it is a user action, if it means losing the channel or the server it is admin. The
 * routes that draw it are listed in `ADMIN_ONLY` in the server's app.ts.
 *
 * `passwordHash` holds the self-describing scrypt form; the plaintext never touches the store.
 */
export const accountSchema = z.object({
  id: z.string().min(1),
  /** Sign-in name, compared case-insensitively. */
  name: z.string().min(1),
  passwordHash: z.string().min(1),
  role: z.enum(["admin", "user"]).default("user"),
  createdAt: z.string(),
  /** True for the account seeded from configuration, so it can never be removed (issue 046). */
  seeded: z.boolean().default(false),
});
export type Account = z.infer<typeof accountSchema>;

/**
 * A server-side session backing one signed-in browser (issue 042's settled policy).
 *
 * Two clocks, both stored, deliberately: `lastSeenAt` moves forward on every authenticated
 * request and expires the session after 30 idle days, while `absoluteExpiresAt` is fixed at
 * creation and caps the session at 90 days no matter how active it has been. Keeping the cap on
 * the record — rather than recomputing it from the last activity — is what makes it a cap:
 * activity cannot extend it, only re-authentication issues a new one.
 *
 * Only a SHA-256 hash of the cookie token is stored. A leaked `store.json` therefore hands over
 * no usable session, the same reasoning PRD-15 applies to the refresh token in issue 067.
 */
export const sessionSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  tokenHash: z.string().min(1),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  absoluteExpiresAt: z.string(),
});
export type Session = z.infer<typeof sessionSchema>;

/**
 * An unredeemed way in (PRD-15 §2, issue 046).
 *
 * This deployment has no mail server and should not grow one, so there is no "email them a link"
 * step: an admin generates one of these, and hands the URL over however they already talk to that
 * person. Password reset is the same act — a fresh invite, never a recovery flow the server has
 * no channel to deliver.
 *
 * Like a session, only a SHA-256 hash of the token is stored: the plaintext exists once, in the
 * link the admin copies. A leaked `store.json` therefore hands over no usable invite.
 *
 * Redeemed invites are kept rather than deleted. `redeemedAt` is what makes the link single-use,
 * and the record is the only durable trace of who let whom in until the audit log lands
 * (issue 050).
 */
export const inviteSchema = z.object({
  id: z.string().min(1),
  tokenHash: z.string().min(1),
  /** The role the redeemed account gets. Chosen when the invite is made, not by the invitee. */
  role: z.enum(["admin", "user"]).default("user"),
  /** The account id of the admin who created it. */
  createdBy: z.string().min(1),
  createdAt: z.string(),
  expiresAt: z.string(),
  /** Set the moment it is used, which is what stops it being used twice. Null while open. */
  redeemedAt: z.string().nullable().default(null),
  /** The account id it created, once redeemed. */
  redeemedBy: z.string().nullable().default(null),
});
export type Invite = z.infer<typeof inviteSchema>;

/**
 * A credential for a machine, not a person (PRD-15 §2, issue 047).
 *
 * The Companion module runs unattended on a shared machine and cannot sign in: its credential
 * lives in a config file that anyone with the desk can read. So a device token buys exactly one
 * thing — running the show — and is refused on every admin-only route no matter how it is
 * presented. There is no `role` field here on purpose: a machine token that could be an admin is
 * a config file that owns the channel.
 *
 * Only a SHA-256 hash of the token is stored, exactly as for sessions and invites. The plaintext
 * exists once, in the response to the create call, and is never retrievable afterwards.
 *
 * Revoked tokens are kept rather than deleted, so `lastUsedAt` still answers "was this the one
 * that was live on the machine we just cut off?" after the fact.
 */
export const deviceTokenSchema = z.object({
  id: z.string().min(1),
  /** What an admin calls it — "companion machine", "booth laptop". Names the thing to revoke. */
  name: z.string().min(1),
  tokenHash: z.string().min(1),
  /** The account id of the admin who created it. */
  createdBy: z.string().min(1),
  createdAt: z.string(),
  /** Coarse (5-minute) last-use stamp, so a live token can be told from a forgotten one. */
  lastUsedAt: z.string().nullable().default(null),
  /** Set when revoked. A stamped token is refused from its next request and its live socket. */
  revokedAt: z.string().nullable().default(null),
});
export type DeviceToken = z.infer<typeof deviceTokenSchema>;

/**
 * Grace mode, and the evidence for ending it (PRD-15 §4, issues 042 and 047).
 *
 * The module in the field carries no token yet (issue 048 gives it one), so the Companion-facing
 * endpoints accept a tokenless caller while `enforcing` is false. That is authentication switched
 * off, and the only thing that keeps "temporary" from becoming permanent is a readout saying when
 * it is safe to turn on.
 *
 * The exit condition is **two counters, not one**. Days alone are not evidence: a 14-day
 * off-season satisfies them while the still-tokenless Companion machine sits powered down, and
 * grace mode comes off just in time for the next show to go dark. So a go-live counter runs
 * beside the clock, and both are reset by any tokenless connection.
 */
export const graceSchema = z.object({
  /**
   * The runtime switch issue 049 flips. False means tokenless Companion callers are accepted
   * (and recorded); true means they are refused. Persisted, so flipping it needs no redeploy.
   */
  enforcing: z.boolean().default(false),
  /** When something last connected without a token. Null once nothing ever has. */
  lastTokenlessAt: z.string().nullable().default(null),
  /** How that caller identified itself — user agent, trimmed. Names the offender in the warning. */
  lastTokenlessClient: z.string().nullable().default(null),
  /** Where it came from, so the warning points at a machine rather than at a mystery. */
  lastTokenlessFrom: z.string().nullable().default(null),
  /** Which endpoint it reached, so "the module" can be told from "somebody's curl". */
  lastTokenlessRoute: z.string().nullable().default(null),
  /** Total tokenless connections ever seen. Never reset — it is the size of the problem. */
  tokenlessCount: z.number().int().min(0).default(0),
  /**
   * Go-lives observed since the last tokenless connection. Reset to zero by one, which is what
   * makes "a show ran tokenless" fail the exit condition rather than quietly satisfying it.
   */
  goLivesSinceTokenless: z.number().int().min(0).default(0),
  /**
   * The broadcast id the go-live counter last counted. The poll loop sees the same live
   * broadcast every few seconds; without this, one show would read as a thousand go-lives.
   */
  lastGoLiveId: z.string().nullable().default(null),
});
export type Grace = z.infer<typeof graceSchema>;

/**
 * Whether YouTube lets this channel create broadcasts, or only lets this app ride along with
 * broadcasts somebody made in Studio (PRD-16 §6, issue 061).
 *
 * Detected, never guessed. YouTube refuses `liveBroadcasts.insert` on an ineligible channel with
 * a named reason — the subscriber threshold is the usual cause, but the threshold is not the rule
 * and counting subscribers to predict it would be a second, worse copy of YouTube's policy. The
 * refusal is the answer, so the refusal is what is stored.
 *
 * `unknown` is the honest starting state and is not the same as `riding`: nothing has been
 * refused, so nothing may be disabled on the strength of it.
 *
 * Deliberately not part of `cache`, and deliberately not a health state. Health answers "can we
 * reach YouTube"; this answers "what is this channel allowed to do" — a perfectly healthy
 * connection to an ineligible channel is the normal case here, and folding the two together
 * would light the reconnect banner over a channel whose sign-in is fine.
 */
export const liveEligibilitySchema = z.object({
  mode: z.enum(["unknown", "driving", "riding"]).default("unknown"),
  /** YouTube's own refusal reason code, kept verbatim so the finding can be checked later. */
  reason: z.string().nullable().default(null),
  /** YouTube's own words for the refusal. Shown as evidence, never rewritten. */
  message: z.string().nullable().default(null),
  /** When the mode was first observed. Null while unknown. */
  checkedAt: z.string().nullable().default(null),
});
export type LiveEligibility = z.infer<typeof liveEligibilitySchema>;
export type LiveEligibilityMode = LiveEligibility["mode"];

export const storeSchema = z.object({
  credentials: credentialsSchema.default({ clientId: "", clientSecret: "", refreshToken: "" }),
  liveEligibility: liveEligibilitySchema.default({
    mode: "unknown",
    reason: null,
    message: null,
    checkedAt: null,
  }),
  presets: z.array(presetSchema).default([]),
  defaults: defaultSettingsSchema.default({
    defaultCategory: null,
    defaultStreamBoundId: null,
  }),
  accounts: z.array(accountSchema).default([]),
  sessions: z.array(sessionSchema).default([]),
  invites: z.array(inviteSchema).default([]),
  deviceTokens: z.array(deviceTokenSchema).default([]),
  grace: graceSchema.default({}),
  quota: quotaSchema.default({ date: null, used: 0 }),
  webhook: webhookSchema.default({ url: null }),
  notify: notifySchema.default({ ntfyServer: "https://ntfy.sh", ntfyTopic: "", publicBaseUrl: "" }),
  service: serviceSchema.default({ apiEnabled: true }),
  targetPin: targetPinSchema.nullable().default(null),
  cache: cacheSchema.default({
    status: {
      broadcastId: null,
      title: null,
      privacyStatus: null,
      isLive: false,
      noTarget: false,
    },
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
