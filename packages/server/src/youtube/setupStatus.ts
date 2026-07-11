import type { CredentialsState } from "../storage/schema.js";
import type { OAuthFlow } from "@app/shared";

/**
 * Which credential flow is currently backing the app (PRD-03 §3, issue 014 Settings page).
 * Derived from the stored credentials, never from secrets leaving the server:
 *
 * - `bundled`  — connected through the OAuth client shipped with this build.
 * - `override` — connected through the operator's own client (stored ID differs from the bundled one).
 * - `env`      — configured, but no client is in the store, so it came from env vars / the CLI.
 * - `null`     — not configured yet.
 */
export function deriveActiveFlow(
  creds: CredentialsState,
  opts: { configured: boolean; bundledClientId?: string },
): OAuthFlow | null {
  if (!opts.configured) return null;
  // A stored client + refresh token means the in-app flow ran; the client id tells us which one.
  if (creds.clientId && creds.refreshToken) {
    return opts.bundledClientId && creds.clientId === opts.bundledClientId ? "bundled" : "override";
  }
  // Configured without stored credentials → supplied out-of-band via environment or the CLI.
  return "env";
}
