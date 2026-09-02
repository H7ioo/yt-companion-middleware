import { scrubSecrets } from "./secrets.js";

/** Error codes from PRD §7. Action endpoints always return HTTP 200 with these in the body. */
export type ErrorCode =
  | "NO_TARGET_FOUND"
  | "YOUTUBE_AUTH_ERROR"
  | "YOUTUBE_QUOTA_EXCEEDED"
  | "INVALID_PRESET"
  | "MISSING_TEMPLATE_VARS"
  | "BUSY_TRY_AGAIN"
  | "NO_UNDO_AVAILABLE"
  | "SERVICE_DISABLED"
  | "YOUTUBE_ERROR"
  | "NETWORK_ERROR"
  | "INVALID_REQUEST"
  | "OAUTH_FAILED"
  | "OAUTH_NO_REFRESH_TOKEN"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_CREDENTIALS"
  | "TOO_MANY_ATTEMPTS"
  | "INVITE_INVALID"
  | "BROADCAST_WRITE_UNSAFE"
  | "SERVER_ERROR";

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  NO_TARGET_FOUND: "No active broadcast and no persistent container found",
  YOUTUBE_AUTH_ERROR: "YouTube API rejected the request due to token issues",
  YOUTUBE_QUOTA_EXCEEDED: "YouTube API quota exceeded, try again later",
  INVALID_PRESET: "Preset not found",
  MISSING_TEMPLATE_VARS: "One or more template variables are unresolved and have no fallback",
  BUSY_TRY_AGAIN: "A request is already in flight and the queue slot is full",
  NO_UNDO_AVAILABLE: "No previous state to undo — no change has been made yet",
  SERVICE_DISABLED: "The YouTube API is switched off from the dashboard — re-enable it to run actions",
  YOUTUBE_ERROR: "YouTube API request failed",
  NETWORK_ERROR:
    "Could not reach YouTube — likely a firewall or network problem, not a login problem",
  INVALID_REQUEST: "Invalid request payload",
  OAUTH_FAILED: "The YouTube sign-in flow did not complete",
  OAUTH_NO_REFRESH_TOKEN:
    "Google returned no refresh token — revoke the app at myaccount.google.com/permissions and reconnect",
  UNAUTHENTICATED: "Sign in to continue",
  // Distinct from UNAUTHENTICATED on purpose: the caller is known, and signing in again as the
  // same person would change nothing (issue 045).
  FORBIDDEN: "Your account cannot do that — ask an admin",
  // Deliberately says nothing about which half was wrong — see routes/auth.ts.
  INVALID_CREDENTIALS: "Incorrect username or password",
  TOO_MANY_ATTEMPTS: "Too many sign-in attempts — try again later",
  // The invite link is unknown, spent or past its expiry. The three are not distinguished to the
  // caller by code, only by message: all three mean "ask an admin for a new link" (issue 046).
  INVITE_INVALID: "That invite link cannot be used — ask an admin for a new one",
  // Raised before the write leaves the process, never by YouTube: the update body had lost a
  // field the fetched broadcast had, and sending it would have deleted that field (issue 056).
  BROADCAST_WRITE_UNSAFE:
    "Refused to write the broadcast — the update would have deleted fields it should have preserved",
  SERVER_ERROR: "The server could not complete the request",
};

export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = "AppError";
    this.code = code;
  }
}

export interface ErrorBody {
  success: false;
  error: { code: ErrorCode; message: string };
}

export function toErrorBody(err: unknown): ErrorBody {
  if (err instanceof AppError) {
    return { success: false, error: { code: err.code, message: scrubSecrets(err.message) } };
  }
  // Scrubbed because this branch is the one that carries text this repo did not write: a message
  // from googleapis or from Node, which can quote the request it failed on — credentials and all
  // (issue 067).
  const message = scrubSecrets(err instanceof Error ? err.message : String(err));
  return { success: false, error: { code: "YOUTUBE_ERROR", message } };
}
