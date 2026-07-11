import http from "node:http";
import { google } from "googleapis";
import { AppError } from "../core/errors.js";

/**
 * In-app YouTube OAuth flow (PRD-03 §2). Moves the loopback dance from
 * `scripts/get-refresh-token.mjs` into the app so no one copies a refresh token by hand:
 * start a loopback catcher, open the real consent screen in the system browser, exchange the
 * code, and hand back the refresh token for the caller to persist. The token is returned to the
 * caller (the Electron/server process) only — never to a browser-facing endpoint.
 */

/** Loopback port the consent redirect lands on. Registered on the OAuth client's redirect URI. */
export const OAUTH_PORT = 53682;
export const OAUTH_REDIRECT = `http://localhost:${OAUTH_PORT}/oauth2callback`;
/** Single read+write YouTube scope — a Google "sensitive" scope (PRD-03 §1). No split. */
export const OAUTH_SCOPES = ["https://www.googleapis.com/auth/youtube"];

/** The slice of the googleapis OAuth2 client this flow uses. Injectable so tests stay offline. */
export interface OAuthClientLike {
  generateAuthUrl(opts: { access_type: string; prompt: string; scope: string[] }): string;
  getToken(code: string): Promise<{ tokens: { refresh_token?: string | null } }>;
}

export type OAuthClientFactory = (
  clientId: string,
  clientSecret: string,
  redirect: string,
) => OAuthClientLike;

export interface RunOAuthFlowDeps {
  clientId: string;
  clientSecret: string;
  /** Opens the consent URL in the system browser (shell.openExternal in Electron). */
  openBrowser: (url: string) => void | Promise<void>;
  /** Override the loopback port (tests only); production always uses {@link OAUTH_PORT}. */
  port?: number;
  /** Override the OAuth client (tests only); production uses the real googleapis client. */
  oauthFactory?: OAuthClientFactory;
}

const defaultFactory: OAuthClientFactory = (clientId, clientSecret, redirect) => {
  const client = new google.auth.OAuth2(clientId, clientSecret, redirect);
  return {
    generateAuthUrl: (opts) => client.generateAuthUrl(opts),
    getToken: async (code) => {
      const { tokens } = await client.getToken(code);
      return { tokens };
    },
  };
};

/**
 * Runs the consent → code → token exchange and resolves with the refresh token. Rejects with an
 * {@link AppError} when credentials are missing, the exchange fails, or Google returns no refresh
 * token (already-granted case — the caller surfaces the revoke-and-retry guidance).
 */
export async function runOAuthFlow(deps: RunOAuthFlowDeps): Promise<{ refreshToken: string }> {
  const { clientId, clientSecret, openBrowser } = deps;
  const port = deps.port ?? OAUTH_PORT;
  const redirect = `http://localhost:${port}/oauth2callback`;

  if (!clientId || !clientSecret) {
    throw new AppError("OAUTH_FAILED", "Missing OAuth client ID or secret.");
  }

  const oauth = (deps.oauthFactory ?? defaultFactory)(clientId, clientSecret, redirect);
  const authUrl = oauth.generateAuthUrl({
    access_type: "offline", // ask Google for a refresh token
    prompt: "consent", // force it even if the user previously granted
    scope: OAUTH_SCOPES,
  });

  return await new Promise<{ refreshToken: string }>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // The browser fetches favicon etc. against the loopback host — ignore anything that
      // isn't the OAuth redirect so a stray request can't resolve the flow.
      if (!req.url?.startsWith("/oauth2callback")) {
        res.writeHead(404).end();
        return;
      }
      const code = new URL(req.url, redirect).searchParams.get("code");
      if (!code) {
        res.writeHead(400).end("No authorization code in the callback.");
        return;
      }
      void (async () => {
        try {
          const { tokens } = await oauth.getToken(code);
          if (!tokens.refresh_token) {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("Connected, but no refresh token was returned — see the app.");
            reject(
              new AppError(
                "OAUTH_NO_REFRESH_TOKEN",
                "Google returned no refresh token because this app was already authorised. " +
                  "Revoke its access at https://myaccount.google.com/permissions and reconnect.",
              ),
            );
            return;
          }
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("YouTube connected. You can close this tab and return to the app.");
          resolve({ refreshToken: tokens.refresh_token });
        } catch (err) {
          res.writeHead(500).end("Token exchange failed. Return to the app.");
          reject(
            new AppError(
              "OAUTH_FAILED",
              err instanceof Error ? err.message : "Token exchange failed.",
            ),
          );
        } finally {
          close();
        }
      })();
    });

    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      server.closeAllConnections?.();
      server.close();
    };

    server.on("error", (err) => {
      close();
      reject(new AppError("OAUTH_FAILED", `Could not start the loopback catcher: ${err.message}`));
    });

    server.listen(port, () => {
      void Promise.resolve(openBrowser(authUrl)).catch((err) => {
        close();
        reject(
          new AppError(
            "OAUTH_FAILED",
            err instanceof Error ? err.message : "Could not open the browser.",
          ),
        );
      });
    });
  });
}
