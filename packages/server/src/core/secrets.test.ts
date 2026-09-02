import { beforeEach, describe, expect, it } from "vitest";
import { forgetSecrets, rememberSecret, scrubSecrets } from "./secrets.js";
import { toErrorBody } from "./errors.js";
import { Logger } from "./logger.js";
import { resolveCredentials } from "../config.js";

/**
 * Issue 067: the refresh token is stored in plaintext, so the compensating control is that it never
 * appears anywhere a plaintext file is not — an activity feed the operator screenshots, an error
 * body that reaches a browser, a support bundle. Asserted here rather than left to care, because
 * every one of these strings is built by a caller who was not thinking about credentials.
 */

const TOKEN = "1//0eXaMpLe-refresh-token-value";

beforeEach(() => {
  forgetSecrets();
  rememberSecret(TOKEN);
});

describe("scrubbing credential values", () => {
  it("replaces a known credential wherever it appears in a string", () => {
    expect(scrubSecrets(`refresh_token=${TOKEN}&grant_type=refresh_token`)).toBe(
      "refresh_token=[redacted]&grant_type=refresh_token",
    );
  });

  it("leaves text that carries no credential untouched", () => {
    expect(scrubSecrets("YouTube returned 403")).toBe("YouTube returned 403");
  });

  it("ignores empty and trivially short values, which would redact everything", () => {
    rememberSecret("");
    rememberSecret("ab");
    expect(scrubSecrets("a stable ab of text")).toBe("a stable ab of text");
  });
});

describe("the surfaces a credential must never reach", () => {
  it("keeps a credential out of an error payload built from a raw thrown error", () => {
    const body = toErrorBody(new Error(`Bad Request: invalid refresh token ${TOKEN}`));
    expect(body.error.message).not.toContain(TOKEN);
    expect(body.error.message).toContain("[redacted]");
  });

  it("keeps a credential out of the activity log", () => {
    const logger = new Logger();
    logger.push({
      level: "error",
      category: "auth",
      code: "YOUTUBE_AUTH_ERROR",
      message: `token ${TOKEN} was rejected`,
    });
    expect(JSON.stringify(logger.list())).not.toContain(TOKEN);
  });
});

describe("registering the live credentials", () => {
  it("learns the effective credentials as they are resolved, without being told separately", () => {
    // resolveCredentials is the one place the effective values are decided — at boot and again on
    // a hot re-apply after reconnecting. Registering anywhere else means a reconnect leaves the
    // scrubber holding the *previous* token and blind to the current one.
    forgetSecrets();
    const config = { youtube: { clientId: "", clientSecret: "", refreshToken: "" } };
    resolveCredentials(config as never, {
      clientId: "client-id-not-a-secret",
      clientSecret: "s3cret-client-secret-value",
      refreshToken: "1//another-refresh-token",
    } as never);

    expect(scrubSecrets("secret=s3cret-client-secret-value")).toBe("secret=[redacted]");
    expect(scrubSecrets("token=1//another-refresh-token")).toBe("token=[redacted]");
  });
});

// Issue 067 follow-up. The claim above — "at boot and again on a hot re-apply" — was only half
// true: server.ts's applyCredentials built the client straight off the new credentials and never
// went through resolveCredentials, so after an in-app reconnect the scrubber still held the
// previous token and had never seen the live one. That is precisely the case the registration
// exists for, so it is the case worth pinning.
describe("re-registering after a reconnect", () => {
  it("scrubs the token that replaced the one it was booted with", () => {
    forgetSecrets();
    const config = { youtube: { clientId: "", clientSecret: "", refreshToken: "" } };
    const boot = {
      clientId: "client-id",
      clientSecret: "boot-client-secret-value",
      refreshToken: "1//boot-refresh-token",
    };
    resolveCredentials(config as never, boot as never);

    // What the reconnect hands applyCredentials, which now routes through here too.
    resolveCredentials(config as never, {
      clientId: "client-id",
      clientSecret: "fresh-client-secret-value",
      refreshToken: "1//fresh-refresh-token",
    } as never);

    expect(scrubSecrets("token=1//fresh-refresh-token")).toBe("token=[redacted]");
    expect(scrubSecrets("secret=fresh-client-secret-value")).toBe("secret=[redacted]");
    // The old one stays registered: it is still valid at Google until it is revoked, so it is
    // still worth keeping out of a log.
    expect(scrubSecrets("token=1//boot-refresh-token")).toBe("token=[redacted]");
  });
});
