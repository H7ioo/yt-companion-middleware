import type { HealthStatus } from "./schema.js";

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
