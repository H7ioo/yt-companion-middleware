import { describe, expect, it, vi } from "vitest";
import { connectYouTube } from "./connect.js";
import { AppError } from "../core/errors.js";
import type { CredentialsState } from "../storage/schema.js";

/** A minimal in-memory stand-in for JsonStore's credentials read/write surface. */
function fakeStore(credentials: CredentialsState) {
  const state = { credentials: { ...credentials } };
  return {
    get: () => state,
    update: vi.fn(async (mutator: (s: typeof state) => void) => {
      mutator(state);
      return state;
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const EMPTY: CredentialsState = { clientId: "", clientSecret: "", refreshToken: "" };

describe("connectYouTube", () => {
  it("runs the flow with the bundled client and persists the refresh token", async () => {
    const store = fakeStore(EMPTY);
    const runFlow = vi.fn(async () => ({ refreshToken: "rt-bundled" }));
    const applyCredentials = vi.fn();

    await connectYouTube({
      store,
      bundledClient: { clientId: "bundled-id", clientSecret: "bundled-secret" },
      openBrowser: vi.fn(),
      applyCredentials,
      runFlow,
    });

    expect(runFlow).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "bundled-id", clientSecret: "bundled-secret" }),
    );
    expect(store.get().credentials).toEqual({
      clientId: "bundled-id",
      clientSecret: "bundled-secret",
      refreshToken: "rt-bundled",
    });
    expect(applyCredentials).toHaveBeenCalledWith(store.get().credentials);
  });

  it("prefers an operator's own stored client over the bundled one", async () => {
    const store = fakeStore({ clientId: "own-id", clientSecret: "own-secret", refreshToken: "" });
    const runFlow = vi.fn(async () => ({ refreshToken: "rt-override" }));

    await connectYouTube({
      store,
      bundledClient: { clientId: "bundled-id", clientSecret: "bundled-secret" },
      openBrowser: vi.fn(),
      applyCredentials: vi.fn(),
      runFlow,
    });

    expect(runFlow).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "own-id", clientSecret: "own-secret" }),
    );
  });

  it("fails without running the flow when no client is available", async () => {
    const store = fakeStore(EMPTY);
    const runFlow = vi.fn();

    const err = await connectYouTube({
      store,
      bundledClient: undefined,
      openBrowser: vi.fn(),
      applyCredentials: vi.fn(),
      runFlow,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("OAUTH_FAILED");
    expect(runFlow).not.toHaveBeenCalled();
  });
});
