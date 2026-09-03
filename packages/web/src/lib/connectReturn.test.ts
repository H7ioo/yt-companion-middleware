import { describe, expect, it } from "vitest";
import { readConnectReturn } from "./connectReturn.js";

/**
 * What the browser carries back from the hosted connect flow (issue 052). The admin leaves the
 * dashboard for accounts.google.com and comes back to a fresh page load, so the *only* thing that
 * survives the round trip is the query string — and the outcome has to be read out of it before
 * the address bar is tidied, or a reload would replay a stale message.
 */
describe("readConnectReturn", () => {
  const at = (search: string) => new URL(`https://live.example.org/${search}`);

  it("finds nothing on an ordinary load", () => {
    expect(readConnectReturn(at(""))).toBeNull();
    expect(readConnectReturn(at("?tab=presets"))).toBeNull();
  });

  it("reads a successful connect", () => {
    expect(readConnectReturn(at("?connected=youtube"))).toEqual({ ok: true });
  });

  it("reads a failure and keeps the server's own words", () => {
    // The message is the server's explanation of *why* — revoke-and-retry guidance, a denied
    // consent, an expired attempt. Flattening it to "connect failed" would lose the next step.
    expect(readConnectReturn(at("?connect_error=Google%20returned%20no%20refresh%20token"))).toEqual({
      ok: false,
      message: "Google returned no refresh token",
    });
  });

  it("falls back to a plain message rather than an empty one", () => {
    expect(readConnectReturn(at("?connect_error="))).toEqual({
      ok: false,
      message: "The YouTube sign-in did not complete.",
    });
  });

  it("ignores anything else that is not this flow", () => {
    expect(readConnectReturn(at("?connected=something-else"))).toBeNull();
  });
});
