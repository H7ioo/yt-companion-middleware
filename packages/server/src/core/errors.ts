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
  | "INVALID_REQUEST";

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
  INVALID_REQUEST: "Invalid request payload",
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
    return { success: false, error: { code: err.code, message: err.message } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: { code: "YOUTUBE_ERROR", message } };
}
