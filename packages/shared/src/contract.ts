import type { HealthStatus, TargetConflict, TargetPin } from "./schema.js";

/**
 * HTTP/DTO contract types — the response shapes the server produces and the web app consumes.
 * These are not persisted, so they are plain types rather than zod schemas; they live here (not
 * duplicated in `web/src/api.ts`) so the two sides can never drift. Server modules that build
 * these responses import the matching type from here.
 */

/** How a template variable got its value (PRD §4). */
export type VarSource = "provided" | "default" | "fallback";

export interface ResolvedVar {
  name: string;
  /** The value used, or null when the field fell back and the variable had none. */
  value: string | null;
  source: VarSource;
}

/** Result of a preset action, as the client reads it off `/api/dashboard/action/preset`. */
export interface PresetActionResult {
  success: boolean;
  resolvedVars?: ResolvedVar[];
  error?: { code: string; message: string };
}

/** An assignable YouTube video category (PRD §3.2 category picker). */
export interface Category {
  id: string;
  title: string;
}

/** A channel live stream (ingestion key) used to validate a preset's stream binding. */
export interface StreamInfo {
  id: string;
  title: string;
  /** cdn ingestion/stream key, when present — useful to disambiguate similarly-named streams. */
  streamName: string | null;
}

/** The cached, Companion-facing status view of the current broadcast. */
export interface FeedbackStatus {
  title: string | null;
  privacyStatus: string | null;
  isLive: boolean;
  noTarget: boolean;
}

/** Health snapshot for Companion feedback endpoints. */
export interface HealthFeedback {
  status: HealthStatus;
  authenticated: boolean;
  message: string | null;
}

/** Cost-weighted YouTube quota snapshot surfaced to the dashboard (PRD quota warnings). */
export interface QuotaSnapshot {
  /** PT calendar day the counter is for (YYYY-MM-DD). */
  date: string;
  used: number;
  limit: number;
  remaining: number;
}

/**
 * A pending "operator, fill this preset" request, raised by a Companion key (which has no
 * keyboard) and answered by whichever open dashboard claims it first — that dashboard pops the
 * fill popup for the preset. Single-slot with a short server-side TTL: unclaimed requests expire
 * rather than popping hours later.
 */
export interface FillRequest {
  /** Server-assigned id — the claim token. */
  id: string;
  presetId: string;
  /** ISO-8601 timestamp of the key press. */
  requestedAt: string;
}

/** The full operational state pushed to the dashboard, the SSE stream, and outbound webhooks. */
export interface DashboardState {
  status: FeedbackStatus;
  activePresetId: string | null;
  /**
   * Short button label safe for Companion's Latin fonts: the active preset's slug, or its id
   * when the slug is unset, or "Custom" when no preset is active (PRD §5.4). A button binds
   * this instead of `status.title` to avoid Arabic rendering as boxes.
   */
  displayLabel: string;
  /**
   * Base64 PNG (no data-URI prefix) of `displayLabel`, and of the full `status.title`,
   * rendered with an Arabic-capable font so a button can show either as an image — sidestepping
   * Companion's tofu boxes entirely. null when there is no text to draw or rendering is
   * unavailable. A button typically toggles between the two (slug fits; full title may not).
   */
  slugPng: string | null;
  titlePng: string | null;
  health: HealthStatus;
  healthMessage: string | null;
  lastRefreshedAt: string | null;
  busy: boolean;
  quota: QuotaSnapshot;
  undo: { label: string | null; capturedAt: string } | null;
  /** Master API switch — false means the middleware is making no YouTube calls (PRD kill-switch). */
  apiEnabled: boolean;
  /** Unclaimed fill request from a Companion key, or null. Rides the same push as everything else. */
  fillRequest: FillRequest | null;
  /**
   * Set when the broadcast we edit may not be the one that airs — a stray upcoming event, two
   * broadcasts sharing a stream key, or the target changing under us. Independent of `health`:
   * this is "pointed at the wrong thing", not "cannot reach YouTube".
   */
  targetConflict: TargetConflict | null;
  /**
   * The broadcast the operator pinned as the edit target, or null when resolution is inferring
   * it. Surfaced so the dashboard can say which broadcast actions will land on rather than
   * leaving it implicit.
   */
  targetPin: TargetPin | null;
}

/**
 * One broadcast the operator can pin, as offered by GET /api/dashboard/target/candidates. Carries
 * just enough to tell two similarly-named events apart in a dropdown: when it is due, how close
 * to air YouTube considers it, and whether it is the one currently being edited.
 */
export interface BroadcastCandidate {
  id: string;
  title: string;
  /** ISO-8601, or null when the broadcast carries no scheduled start. */
  scheduledStartTime: string | null;
  /** YouTube's lifecycle: `created` (stub), `ready`/`testing` (encoder-bound), `live`. */
  lifeCycleStatus: string | null;
  /** True for the broadcast currently on air — it cannot be pinned away from. */
  isLive: boolean;
  /** True when this is the broadcast target resolution would pick on its own right now. */
  wouldPick: boolean;
}

/** Severity of a dashboard activity-log entry (PRD-06 §3). Drives the panel's colour coding. */
export type LogLevel = "info" | "warn" | "error";

/**
 * Which subsystem an activity-log entry came from (PRD-06 §3), so the panel can filter by it.
 * `auth`/`network`/`quota` mirror the failure classification from issue 016; `action` is a
 * Companion/dashboard write; `system` is server lifecycle and unclassified events.
 */
export type LogCategory = "auth" | "network" | "quota" | "action" | "system";

/** One entry in the in-memory activity ring buffer, served by GET /api/dashboard/logs. */
export interface LogEntry {
  /** ISO-8601 timestamp of when the event was recorded. */
  ts: string;
  level: LogLevel;
  category: LogCategory;
  /** The originating error/action code (e.g. an ErrorCode), or null for a bare message. */
  code: string | null;
  message: string;
}

/** Which OAuth credential flow is backing the app (issue 014 Settings connection section). */
export type OAuthFlow = "bundled" | "override" | "env";

/** Setup-screen status: whether credentials are present (booleans only — secrets never leave the server). */
export interface SetupStatus {
  configured: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasRefreshToken: boolean;
  /** The active credential flow, or null when not configured. Shown on the Settings page. */
  activeFlow: OAuthFlow | null;
  /** A bundled OAuth client shipped with this build, so one-click "Connect YouTube" is offered. */
  hasBundledClient: boolean;
  /** The host can run the in-app OAuth flow (Electron); false for headless/Docker boots. */
  canConnect: boolean;
  /**
   * The loopback redirect URI the in-app flow listens on. Shown to operators using their own
   * OAuth client so they can register it as an authorized redirect (PRD-03 §3 override flow).
   */
  redirectUri: string;
}

/**
 * What the desktop updater is doing right now (PRD-09 §A.1, issue 038). `unsupported` covers every
 * host that has no update feed at all — Docker, the portable exe, a dev run — and means the UI
 * should say nothing about updates.
 */
export type UpdateStatus =
  | "unsupported"
  | "checking"
  | "idle"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  /** The version being offered, once one is known. */
  version?: string;
  /** Why the last check failed. Advisory — the app keeps running on its current version. */
  error?: string;
  /**
   * Download progress, 0–100, while status is "downloading". Omitted before the first progress
   * event fires — the banner shows a bare "downloading" until then.
   */
  percent?: number;
  /**
   * Release notes for the offered version, taken from the update feed itself (plain text). The
   * feed is the only place the newer version's notes exist — the bundled changelog, by
   * construction, cannot describe a version this build predates (PRD-10 §3). Omitted when the
   * feed carried none.
   */
  notes?: string;
}

/** One "### Added"-style group inside a release's notes. */
export interface ReleaseSection {
  title: string;
  items: string[];
}

/** One release's changelog entry, parsed from the bundled CHANGELOG.md (PRD-09 §B.2). */
export interface ReleaseNotes {
  version: string;
  date: string;
  sections: ReleaseSection[];
}

/**
 * GET /api/dashboard/app — what the app is running, what it could run next, and the notes for
 * both. Read from the bundled changelog, so it works offline and always matches the binary.
 */
export interface AppInfo {
  /** Version of the running app. */
  version: string;
  /** Notes for the running version, or null when the changelog has no section for it. */
  notes: ReleaseNotes | null;
  update: UpdateState;
  /**
   * Plain-text notes for the version on offer, so the operator sees what they'd get before
   * installing. Sourced from the update feed (see {@link UpdateState.notes}), not the bundled
   * changelog — the running build cannot ship a newer version's notes (PRD-10 §3). null when the
   * feed carried none or no update is offered.
   */
  updateNotes: string | null;
}

/**
 * One person on this deployment, as `GET /api/dashboard/people` reports them (issue 045). The
 * password hash never appears in this shape — it is the reason the shape exists.
 */
export interface Person {
  id: string;
  name: string;
  role: "admin" | "user";
  createdAt: string;
  /** The account seeded from configuration. It cannot be removed (issue 046). */
  seeded: boolean;
}

/**
 * An outstanding or spent invite, as the People panel lists them (issue 046). The token itself is
 * never in here — it is returned exactly once, from the create call, and is not recoverable
 * afterwards. An admin who loses the link makes another one.
 */
export interface InviteSummary {
  id: string;
  role: "admin" | "user";
  createdAt: string;
  expiresAt: string;
  /** The name of the admin who created it, or null if that account has since been removed. */
  invitedBy: string | null;
  /** `open` is the only one still usable; the other two are shown so the list explains itself. */
  state: "open" | "expired" | "redeemed";
  /** The name of the account it created, once redeemed. */
  redeemedBy: string | null;
}

/**
 * One signed-in browser belonging to an account (issue 046). Enough to tell two devices apart and
 * decide which to cut off — the lost-phone case — and deliberately no more: this list is shown to
 * an admin about somebody else, so it carries no token, no address and no user agent.
 */
export interface DeviceSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  absoluteExpiresAt: string;
}

/**
 * What the dashboard knows about its own sign-in state, from `GET /api/auth/me` (issue 043).
 *
 * `authRequired` is the switch: a deployment with no accounts — the desktop and LAN installs the
 * app ships as today — reports false, and the dashboard shows no login screen at all. The hosted
 * deployment seeds an admin at boot and reports true.
 */
export interface SessionInfo {
  authRequired: boolean;
  authenticated: boolean;
  account: { id: string; name: string; role: "admin" | "user" } | null;
  /** Within a week of the 90-day cap: the dashboard offers to re-authenticate before it lapses. */
  expiringSoon: boolean;
  /** When the session's absolute cap falls, so the notice can name the day. Null when signed out. */
  absoluteExpiresAt: string | null;
}

/**
 * One device token as the admin panel lists them (issue 047). The token itself is never in here:
 * it is returned exactly once, from the create call. An admin who loses it revokes and makes
 * another, which is also the only honest thing to offer — the server keeps only a hash.
 */
export interface DeviceTokenSummary {
  id: string;
  name: string;
  createdAt: string;
  /** The name of the admin who created it, or null if that account has since been removed. */
  createdBy: string | null;
  /** Coarse last-use stamp. Null for a token that has never been presented. */
  lastUsedAt: string | null;
  /** Set once revoked; a revoked token is refused and its live socket is dropped. */
  revokedAt: string | null;
}

/**
 * Whether it is safe to turn grace mode off (issues 042, 047 and 049).
 *
 * Deliberately two counters. `days` alone would let a 14-day off-season read as "met" while the
 * still-tokenless Companion machine sits powered down — grace mode would come off just in time
 * for the next show to go dark. `met` is true only when both halves hold.
 */
export interface GraceReadout {
  /** False while tokenless Companion callers are still accepted. Issue 049 flips it. */
  enforcing: boolean;
  /** Whole days since the last tokenless connection. Null when nothing tokenless has ever connected. */
  daysSinceTokenless: number | null;
  /** The threshold `daysSinceTokenless` is measured against. */
  daysRequired: number;
  /** Go-lives observed since the last tokenless connection. Reset to zero by one. */
  goLivesSinceTokenless: number;
  /** The threshold `goLivesSinceTokenless` is measured against. */
  goLivesRequired: number;
  /** True only when both halves hold. 14 quiet days with no go-live in them is not met. */
  met: boolean;
  /** When something last connected without a token. Null when nothing ever has. */
  lastTokenlessAt: string | null;
  /** Who that was, as far as the server can tell: user agent, address and the route reached. */
  lastTokenlessClient: string | null;
  lastTokenlessFrom: string | null;
  lastTokenlessRoute: string | null;
  /** Total tokenless connections ever seen. Never reset — it is the size of the problem. */
  tokenlessCount: number;
}

/**
 * Who did the thing, as the audit log records them (issue 050, PRD-15 §3).
 *
 * A machine is named by its device token's name, never as "unknown" — a log that cannot tell one
 * Companion box from another answers none of the questions it exists for. `anonymous` is what a
 * caller with no credential looks like: sign-in itself, and — until issue 049 flips the switch —
 * a tokenless Companion request under grace mode.
 */
export interface AuditActor {
  kind: "person" | "machine" | "anonymous";
  /** Account id or device-token id. Null for an anonymous caller. */
  id: string | null;
  /** The name to show. For a machine, the token's name. */
  name: string;
}

/** What happened to the request the entry records. */
export type AuditOutcome = "ok" | "refused" | "failed";

/**
 * One line of the durable audit log: **who, what, which target, what happened, when** (PRD-15 §3).
 *
 * Deliberately not a {@link LogEntry}. The activity feed is a 200-entry in-memory ring buffer that
 * wants noise — polls, refreshes, health transitions — and starts fresh on restart. This is the
 * opposite: only what a *person* did, on disk, kept for months. One store cannot serve both.
 */
export interface AuditEntry {
  id: string;
  /** ISO-8601, stamped when the request finished. */
  ts: string;
  actor: AuditActor;
  /** What was done, in words: "made someone an admin". Falls back to "POST /api/…". */
  action: string;
  method: string;
  /** The path as it was called, ids included. */
  path: string;
  /** The specific thing acted on — an account id, a token id — when the route names one. */
  target: string | null;
  outcome: AuditOutcome;
  status: number;
  /**
   * The request body, with every secret-shaped value replaced by `[redacted]`. Null when there
   * was none. A log is the thing most likely to be copied around, so no token, secret or
   * credential value ever reaches it.
   */
  detail: Record<string, unknown> | null;
  /**
   * Role and account changes — the entries someone will actually come looking for. "X changed the
   * title" is routine; "X made Y an admin" is not, and the viewer filters on this.
   */
  notable: boolean;
}

/**
 * One row of the broadcast list that answers "which one will air?" (PRD-16 §1, issue 057).
 *
 * Deliberately richer than {@link BroadcastCandidate}, which exists to tell two similarly-named
 * events apart in a picker. This carries the evidence the *airing* decision is made from —
 * the bound stream and the auto-start flag — because a row that shows a title and a time cannot
 * explain why YouTube will feed one event and not the other.
 */
export interface BroadcastListEntry {
  id: string;
  title: string;
  /** ISO-8601, or null when the broadcast carries no scheduled start. */
  scheduledStartTime: string | null;
  privacyStatus: string | null;
  /** YouTube's lifecycle: `created` (stub), `ready`/`testing` (encoder-bound), `live`. */
  lifeCycleStatus: string | null;
  /** The ingestion key this broadcast is attached to, or null when it is attached to none. */
  boundStreamId: string | null;
  /** That key's name, falling back to its id when the stream list does not carry it. */
  boundStreamTitle: string | null;
  /** `contentDetails.enableAutoStart` — whether the encoder starting is enough to start it. */
  autoStart: boolean;
  /** True for a broadcast YouTube reports as `active` — already on air. */
  isLive: boolean;
  /** The one that will air, or one of several tied for it. Never more than one unless contested. */
  willAir: boolean;
  /** Why this row will or will not air, in words an operator can act on. */
  reason: string;
}

/** The broadcast list as `GET /api/dashboard/broadcasts` reports it (issue 057). */
export interface BroadcastListing {
  entries: BroadcastListEntry[];
  /**
   * The list's headline answer in plain words — which broadcast airs and why, or that none
   * does. Stated rather than left to be inferred from a highlight: "one row is bolder than the
   * others" is exactly the kind of answer that sends an operator to Studio to check.
   */
  verdict: string;
  /**
   * More than one upcoming broadcast qualifies. Both are marked rather than one silently
   * winning — the app genuinely cannot tell which YouTube will feed, and pretending otherwise
   * is how a show ends up on the wrong event.
   */
  contested: boolean;
  /** The ingestion key the encoder is understood to push to, or null when it is not known. */
  encoderStreamId: string | null;
  encoderStreamTitle: string | null;
  /**
   * How that key was arrived at. `setting` is the operator's default binding; `only-key` is a
   * channel with exactly one ingestion key, where there is nothing else OBS could be pointed
   * at; `unknown` means several keys exist and none was chosen, so no row can be marked.
   */
  encoderSource: "setting" | "only-key" | "unknown";
  /**
   * What this listing cost, in YouTube quota units, measured across the calls it just made
   * rather than assumed. Stated because a list is the kind of thing that gets put on a refresh
   * interval, and the cost of doing that should be visible before someone does.
   */
  quotaUnits: number;
}
