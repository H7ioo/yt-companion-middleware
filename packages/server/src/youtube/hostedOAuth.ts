import crypto from "node:crypto";
import type { JsonStore } from "../storage/jsonStore.js";
import type { CredentialsState } from "../storage/schema.js";
import { AppError } from "../core/errors.js";
import { NO_REFRESH_TOKEN_GUIDANCE, OAUTH_SCOPES, defaultOAuthFactory } from "./oauthFlow.js";
import type { OAuthClientFactory } from "./oauthFlow.js";
import { resetEligibility } from "./eligibility.js";

/**
 * The hosted "Connect YouTube" flow (issue 052, PRD-15 §5).
 *
 * `oauthFlow.ts` runs consent by opening the system browser and catching the redirect on a
 * loopback port. Neither half exists on a headless host: there is no browser to open, and the
 * admin's browser is on another machine entirely, where `localhost:53682` is *their* machine.
 * So the flow is turned inside out — the server hands the admin a URL, their own browser does
 * the consent at the real `accounts.google.com`, and Google redirects them back to this
 * deployment's public origin.
 *
 * That inversion costs one thing the loopback flow got for free. The loopback catcher could only
 * ever be reached by the browser on this machine, so a code arriving at it was necessarily the
 * code we asked for. A public callback can be reached by anyone, so the flow carries a `state`
 * nonce: unguessable, issued here, single-use, short-lived. A callback without one that we
 * recognise is refused before any exchange happens — otherwise a planted authorization code would
 * connect *someone else's* channel to this deployment.
 *
 * The refresh token is written straight to the store and handed to `applyCredentials`. Nothing
 * returns it, so it has no route to the browser that triggered the callback.
 */

/** Where Google sends the admin's browser back. Registered on the OAuth client, character-exact. */
export const HOSTED_CALLBACK_PATH = "/api/setup/oauth/callback";

/** The redirect URI to register on the Google client for a deployment at `origin`. */
export function hostedRedirectUri(origin: string): string {
  return `${origin}${HOSTED_CALLBACK_PATH}`;
}

/**
 * How long a started-but-unfinished connect stays valid. Long enough to pick a Google account,
 * read the unverified-app screen and consent; short enough that an abandoned attempt is not a
 * client secret sitting in memory for the rest of the process's life.
 */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

/**
 * How many unfinished attempts are kept. Each one holds a client secret, and "Connect" is a button
 * that will be clicked repeatedly by an admin who thinks nothing happened. Oldest is dropped
 * first, so the click that is actually being waited on is the one that survives.
 */
const MAX_PENDING = 16;

/** One started connect, waiting for its browser to come back. */
interface Pending {
  clientId: string;
  clientSecret: string;
  expiresAt: number;
}

export interface HostedOAuthDeps {
  store: JsonStore;
  /** The origin Google redirects back to. Non-empty — the caller decides whether this flow exists. */
  publicOrigin: string;
  /** Build-time bundled client, if this build carries one. Headless builds normally do not. */
  bundledClient?: { clientId: string; clientSecret: string };
  /** Rebuilds the in-process YouTube client from the new creds — no restart (PRD-03 §2.4). */
  applyCredentials: (creds: CredentialsState) => void | Promise<void>;
  /** Injectable for tests; production uses the real googleapis client. */
  oauthFactory?: OAuthClientFactory;
  /** Injectable clock, so state expiry is testable without waiting ten minutes. */
  now?: () => number;
  /** Override the pending-state lifetime (tests only). */
  ttlMs?: number;
}

export class HostedOAuth {
  /** The redirect URI this deployment will use — shown in setup status so it can be registered. */
  readonly redirectUri: string;

  private readonly pending = new Map<string, Pending>();
  private readonly deps: HostedOAuthDeps;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(deps: HostedOAuthDeps) {
    this.deps = deps;
    this.redirectUri = hostedRedirectUri(deps.publicOrigin);
    this.now = deps.now ?? Date.now;
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Unfinished attempts currently held. Exposed so the bound on them can be asserted. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Starts a connect: picks the OAuth client, issues a state nonce, and returns the consent URL
   * for the admin's browser to visit. Nothing is written to the store here — a started flow that
   * is never finished must leave the existing connection exactly as it was.
   */
  authorize(override?: { clientId: string; clientSecret: string }): { url: string } {
    const client = this.pickClient(override);
    const state = crypto.randomBytes(24).toString("hex");

    this.sweep();
    // Oldest first, because Map preserves insertion order: the click still being waited on is the
    // newest one, and it is the one that must not be evicted.
    while (this.pending.size >= MAX_PENDING) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
    this.pending.set(state, { ...client, expiresAt: this.now() + this.ttlMs });

    const oauth = (this.deps.oauthFactory ?? defaultOAuthFactory)(
      client.clientId,
      client.clientSecret,
      this.redirectUri,
    );
    return {
      url: oauth.generateAuthUrl({
        access_type: "offline", // ask Google for a refresh token
        prompt: "consent", // force it even if this account previously granted
        scope: OAUTH_SCOPES,
        state,
      }),
    };
  }

  /**
   * Finishes a connect from the callback's query string: validates the state, exchanges the code,
   * persists the credentials and hot-applies them. Resolves with nothing — see the class comment.
   */
  async complete(params: { code?: string; state?: string; error?: string }): Promise<void> {
    // Spend the state before anything else, whatever the outcome. A callback that failed must not
    // leave a nonce behind that a second, differently-shaped callback could still use.
    const client = params.state ? this.pending.get(params.state) : undefined;
    if (params.state) this.pending.delete(params.state);

    if (!client || client.expiresAt <= this.now()) {
      throw new AppError(
        "OAUTH_FAILED",
        "This sign-in link is expired or was not issued by this server — start the connect again from Settings.",
      );
    }

    // Google's own refusal, most often the admin pressing Cancel. Named verbatim rather than
    // flattened, because `access_denied` and `admin_policy_enforced` want different next steps.
    if (params.error) {
      throw new AppError("OAUTH_FAILED", `Google refused the sign-in: ${params.error}`);
    }
    if (!params.code) {
      throw new AppError("OAUTH_FAILED", "Google sent no authorization code back.");
    }

    const oauth = (this.deps.oauthFactory ?? defaultOAuthFactory)(
      client.clientId,
      client.clientSecret,
      this.redirectUri,
    );

    let refreshToken: string | null | undefined;
    try {
      ({
        tokens: { refresh_token: refreshToken },
      } = await oauth.getToken(params.code));
    } catch (err) {
      throw new AppError("OAUTH_FAILED", err instanceof Error ? err.message : "Token exchange failed.");
    }

    // The already-granted case. Nothing is written: a connect that produced no token must leave
    // the working credentials it was meant to replace untouched.
    if (!refreshToken) throw new AppError("OAUTH_NO_REFRESH_TOKEN", NO_REFRESH_TOKEN_GUIDANCE);

    const creds: CredentialsState = {
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      refreshToken,
    };
    await this.deps.store.update((s) => {
      s.credentials = creds;
    });
    // What YouTube allowed was learned about the previous channel, and this may be another one
    // entirely (issue 061). Same reasoning as the loopback flow's reset in connect.ts.
    await resetEligibility(this.deps.store);
    await this.deps.applyCredentials(creds);
  }

  /**
   * Precedence, matching the loopback flow: a freshly-entered override, then the operator's stored
   * client, then the bundled one. The override lets a just-typed client work before it has been
   * persisted — which on a headless deployment is the *only* way the first connect ever happens,
   * since no bundled client ships there.
   */
  private pickClient(override?: { clientId: string; clientSecret: string }): {
    clientId: string;
    clientSecret: string;
  } {
    const stored = this.deps.store.get().credentials;
    const client =
      override?.clientId && override.clientSecret
        ? override
        : stored.clientId && stored.clientSecret
          ? { clientId: stored.clientId, clientSecret: stored.clientSecret }
          : this.deps.bundledClient;

    if (!client?.clientId || !client.clientSecret) {
      throw new AppError(
        "OAUTH_FAILED",
        "No OAuth client available — add your own client ID and secret to connect.",
      );
    }
    return { clientId: client.clientId, clientSecret: client.clientSecret };
  }

  /** Drops attempts that have timed out, so abandoned secrets do not linger. */
  private sweep(): void {
    const now = this.now();
    for (const [state, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(state);
    }
  }
}
