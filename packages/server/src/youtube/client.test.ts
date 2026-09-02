import { describe, expect, it } from "vitest";
import { mapYouTubeError, isAuthError, isNetworkError } from "./client.js";
import { AppError } from "../core/errors.js";
import { forgetSecrets, rememberSecret, scrubSecrets } from "../core/secrets.js";

/** A GaxiosError-shaped object with a status and optional reason list. */
function ytError(status: number, reasons: string[] = [], message = "boom") {
  return {
    response: {
      status,
      data: { error: { errors: reasons.map((reason) => ({ reason })) } },
    },
    message,
  };
}

describe("mapYouTubeError", () => {
  it("passes an existing AppError through untouched", () => {
    const original = new AppError("NO_TARGET_FOUND");
    expect(mapYouTubeError(original)).toBe(original);
  });

  it("maps a 403 quotaExceeded to YOUTUBE_QUOTA_EXCEEDED", () => {
    expect(mapYouTubeError(ytError(403, ["quotaExceeded"])).code).toBe("YOUTUBE_QUOTA_EXCEEDED");
  });

  it("maps rateLimitExceeded to YOUTUBE_QUOTA_EXCEEDED", () => {
    expect(mapYouTubeError(ytError(403, ["rateLimitExceeded"])).code).toBe("YOUTUBE_QUOTA_EXCEEDED");
  });

  it("maps a 401 to YOUTUBE_AUTH_ERROR", () => {
    expect(mapYouTubeError(ytError(401)).code).toBe("YOUTUBE_AUTH_ERROR");
  });

  it("maps a bare 403 (no quota reason) to YOUTUBE_AUTH_ERROR", () => {
    expect(mapYouTubeError(ytError(403)).code).toBe("YOUTUBE_AUTH_ERROR");
  });

  it("maps any other status to YOUTUBE_ERROR and keeps the message", () => {
    const err = mapYouTubeError(ytError(500, [], "server exploded"));
    expect(err.code).toBe("YOUTUBE_ERROR");
    expect(err.message).toBe("server exploded");
  });

  it("reads the status from a top-level `code` when there is no response", () => {
    expect(mapYouTubeError({ code: 401, message: "no creds" }).code).toBe("YOUTUBE_AUTH_ERROR");
  });

  it.each([
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNRESET",
    // The host/route/abort outage family added in PRD-10 §2 — dropped Wi-Fi and strict firewalls
    // surface these, and they must classify as network (→ offline) rather than a transient error.
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ECONNABORTED",
  ])(
    "maps a Node network code %s to NETWORK_ERROR, not auth",
    (code) => {
      const err = mapYouTubeError({ code, message: `connect ${code}` });
      expect(err.code).toBe("NETWORK_ERROR");
      expect(err.message).toBe(`connect ${code}`);
    },
  );
});

describe("isNetworkError", () => {
  it("is true only for an AppError with code NETWORK_ERROR", () => {
    expect(isNetworkError(new AppError("NETWORK_ERROR"))).toBe(true);
    expect(isNetworkError(new AppError("YOUTUBE_AUTH_ERROR"))).toBe(false);
    expect(isNetworkError(new Error("plain"))).toBe(false);
  });
});

describe("isAuthError", () => {
  it("is true only for an AppError with code YOUTUBE_AUTH_ERROR", () => {
    expect(isAuthError(new AppError("YOUTUBE_AUTH_ERROR"))).toBe(true);
    expect(isAuthError(new AppError("YOUTUBE_QUOTA_EXCEEDED"))).toBe(false);
    expect(isAuthError(new Error("plain"))).toBe(false);
  });
});

// Issue 067 follow-up. logger.ts and errors.ts scrub on the way out, but healthMessage takes
// neither route: it is `mapYouTubeError(err).message`, persisted to store.json and served by the
// *unauthenticated* GET /api/feedback/health, plus the dashboard snapshot and every webhook
// payload. Scrubbing where the upstream text becomes an AppError covers all of them at once.
describe("upstream error text that quoted the credentials", () => {
  it("carries no live credential into the message every consumer reads", () => {
    forgetSecrets();
    const token = "1//a-live-refresh-token";
    rememberSecret(token);

    const mapped = mapYouTubeError(ytError(401, ["authError"], `invalid_grant for ${token}`));

    expect(mapped.code).toBe("YOUTUBE_AUTH_ERROR");
    expect(mapped.message).toBe("invalid_grant for [redacted]");
    expect(scrubSecrets(mapped.message)).toBe(mapped.message);
    forgetSecrets();
  });

  it("scrubs a transport failure's message too", () => {
    forgetSecrets();
    rememberSecret("s3cret-client-secret-value");

    const mapped = mapYouTubeError({
      code: "ECONNREFUSED",
      message: "connect ECONNREFUSED while sending s3cret-client-secret-value",
    });

    expect(mapped.code).toBe("NETWORK_ERROR");
    expect(mapped.message).not.toContain("s3cret-client-secret-value");
    forgetSecrets();
  });
});
