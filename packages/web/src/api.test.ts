import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api.js";

/** A reply from something other than this API: the HTML a proxy or a stale dev server serves. */
function reply(body: string, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => body })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the API client on a reply that is not JSON", () => {
  it("says what happened instead of quoting the JSON parser", async () => {
    reply("<!doctype html><title>502 Bad Gateway</title>");
    const err = await api.broadcasts.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    // The operator used to be shown "JSON.parse: unexpected character at line 1 column 1 of the
    // JSON data", which describes the parser's day, not theirs.
    expect((err as Error).message).not.toMatch(/JSON/);
    expect((err as Error).message).toMatch(/server replied/i);
  });

  it("keeps the status's own message when the failure came with one", async () => {
    reply("<html>gateway timeout</html>", { status: 504 });
    const err = await api.broadcasts.list().catch((e: unknown) => e);
    expect((err as Error).message).toBe("Request failed (504)");
  });

  it("still reports the server's error message when the refusal is JSON", async () => {
    reply(JSON.stringify({ error: { message: "Quota exhausted.", code: "quota" } }), { status: 429 });
    const err = await api.broadcasts.list().catch((e: unknown) => e);
    expect((err as ApiError).message).toBe("Quota exhausted.");
    expect((err as ApiError).code).toBe("quota");
  });

  it("passes a normal JSON reply through", async () => {
    reply(JSON.stringify({ entries: [], checkedAt: "2026-09-05T00:00:00.000Z" }));
    await expect(api.broadcasts.list()).resolves.toEqual({
      entries: [],
      checkedAt: "2026-09-05T00:00:00.000Z",
    });
  });
});
