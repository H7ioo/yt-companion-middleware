import { google, type youtube_v3 } from "googleapis";
import type { AppConfig } from "../config.js";
import { AppError } from "../core/errors.js";

/**
 * Builds an authenticated YouTube Data API client from the server-side OAuth refresh
 * token (PRD §5.1). The refresh token is never exposed to any client-facing endpoint.
 */
export function createYouTubeClient(config: AppConfig): youtube_v3.Youtube {
  const oauth2 = new google.auth.OAuth2(
    config.youtube.clientId,
    config.youtube.clientSecret,
  );
  oauth2.setCredentials({ refresh_token: config.youtube.refreshToken });
  return google.youtube({ version: "v3", auth: oauth2 });
}

/**
 * Node/undici error codes that mean "the request never reached YouTube" — a firewall, dead
 * DNS, or no internet. These must be classified apart from auth so a blocked outbound 443
 * does not masquerade as a revoked token (PRD-06 §0).
 */
const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
]);

/** Maps a googleapis/GaxiosError into one of the PRD §7 error codes. */
export function mapYouTubeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  const anyErr = err as {
    code?: number | string;
    status?: number;
    response?: { status?: number; data?: { error?: { errors?: Array<{ reason?: string }> } } };
    message?: string;
  };

  // A transport-level failure carries a string code and no HTTP response — classify it before
  // any status math (Number("ECONNREFUSED") is NaN and would fall through to YOUTUBE_ERROR).
  if (typeof anyErr.code === "string" && NETWORK_ERROR_CODES.has(anyErr.code)) {
    return new AppError("NETWORK_ERROR", anyErr.message);
  }

  const status = Number(anyErr.response?.status ?? anyErr.status ?? anyErr.code);
  const reasons = anyErr.response?.data?.error?.errors?.map((e) => e.reason ?? "") ?? [];
  const message = anyErr.message;

  if (status === 401 || status === 403) {
    const quotaReasons = ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"];
    if (reasons.some((r) => quotaReasons.includes(r))) {
      return new AppError("YOUTUBE_QUOTA_EXCEEDED");
    }
    const authReasons = ["authError", "forbidden", "insufficientPermissions"];
    if (status === 401 || reasons.some((r) => authReasons.includes(r))) {
      return new AppError("YOUTUBE_AUTH_ERROR", message);
    }
    // A bare 403 without a quota reason is most likely an auth/permission problem.
    return new AppError("YOUTUBE_AUTH_ERROR", message);
  }

  return new AppError("YOUTUBE_ERROR", message);
}

/** True when the error should escalate health toward auth_error (not retryable). */
export function isAuthError(err: unknown): boolean {
  return err instanceof AppError && err.code === "YOUTUBE_AUTH_ERROR";
}

/** True for a transport-level failure (firewall / DNS / no internet), which drives `offline`. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof AppError && err.code === "NETWORK_ERROR";
}
