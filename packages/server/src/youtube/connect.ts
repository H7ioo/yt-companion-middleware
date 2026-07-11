import type { JsonStore } from "../storage/jsonStore.js";
import type { CredentialsState } from "../storage/schema.js";
import { AppError } from "../core/errors.js";
import { runOAuthFlow } from "./oauthFlow.js";

/**
 * Orchestrates a "Connect YouTube" click (PRD-03 §2): pick the OAuth client (an operator's own
 * stored client wins over the bundled one), run the loopback consent flow, persist the resulting
 * refresh token, then hot-apply the new credentials. The refresh token is written straight to the
 * store and handed to `applyCredentials` — it is never returned from here, so it can never reach a
 * browser-facing endpoint (acceptance: "refresh token never returned to any client").
 */
export interface ConnectDeps {
  store: JsonStore;
  /**
   * An operator's own client ID/secret, supplied fresh from the "Use my own credentials" form
   * (PRD-03 §1.2, §3). Wins over both the stored and bundled clients so a just-entered override
   * takes effect on the very first connect, before it has been persisted.
   */
  override?: { clientId: string; clientSecret: string };
  /** Bundled client injected by the desktop build; undefined in override-only / headless builds. */
  bundledClient?: { clientId: string; clientSecret: string };
  /** Opens the consent URL in the system browser (shell.openExternal under Electron). */
  openBrowser: (url: string) => void | Promise<void>;
  /** Rebuilds the in-process YouTube client from the new creds — no server restart on the hot path. */
  applyCredentials: (creds: CredentialsState) => void | Promise<void>;
  /** Injectable for tests; defaults to the real loopback flow. */
  runFlow?: typeof runOAuthFlow;
}

export async function connectYouTube(deps: ConnectDeps): Promise<void> {
  const stored = deps.store.get().credentials;
  // Precedence: a freshly-entered override client, then the operator's stored client, then the
  // bundled one. The override lets a just-typed client work before it has been persisted.
  const client =
    deps.override?.clientId && deps.override.clientSecret
      ? deps.override
      : stored.clientId && stored.clientSecret
        ? { clientId: stored.clientId, clientSecret: stored.clientSecret }
        : deps.bundledClient;

  if (!client?.clientId || !client.clientSecret) {
    throw new AppError(
      "OAUTH_FAILED",
      "No OAuth client available — add your own client ID and secret to connect.",
    );
  }

  const runFlow = deps.runFlow ?? runOAuthFlow;
  const { refreshToken } = await runFlow({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    openBrowser: deps.openBrowser,
  });

  const creds: CredentialsState = {
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    refreshToken,
  };
  await deps.store.update((s) => {
    s.credentials = creds;
  });
  await deps.applyCredentials(creds);
}
