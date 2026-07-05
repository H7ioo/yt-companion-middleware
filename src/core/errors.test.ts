import { describe, expect, it } from "vitest";
import { AppError, toErrorBody } from "./errors.js";

describe("AppError", () => {
  it("falls back to the default message for a code when none is given", () => {
    const err = new AppError("NO_TARGET_FOUND");
    expect(err.code).toBe("NO_TARGET_FOUND");
    expect(err.message).toBe("No active broadcast and no persistent container found");
  });

  it("keeps an explicit message over the default", () => {
    const err = new AppError("INVALID_PRESET", "Preset 'x' not found");
    expect(err.message).toBe("Preset 'x' not found");
  });

  it("has a default message for MISSING_TEMPLATE_VARS", () => {
    expect(new AppError("MISSING_TEMPLATE_VARS").message).toMatch(/unresolved/i);
  });
});

describe("toErrorBody", () => {
  it("serializes an AppError with its code and message", () => {
    const body = toErrorBody(new AppError("BUSY_TRY_AGAIN"));
    expect(body).toEqual({
      success: false,
      error: {
        code: "BUSY_TRY_AGAIN",
        message: "A request is already in flight and the queue slot is full",
      },
    });
  });

  it("maps an unknown Error to YOUTUBE_ERROR, preserving its message", () => {
    const body = toErrorBody(new Error("socket hang up"));
    expect(body.error.code).toBe("YOUTUBE_ERROR");
    expect(body.error.message).toBe("socket hang up");
  });

  it("stringifies a non-Error thrown value", () => {
    const body = toErrorBody("boom");
    expect(body.error.code).toBe("YOUTUBE_ERROR");
    expect(body.error.message).toBe("boom");
  });
});
