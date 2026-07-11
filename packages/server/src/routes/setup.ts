import { Router } from "express";
import { z } from "zod";
import type { JsonStore } from "../storage/jsonStore.js";
import { AppError, toErrorBody } from "../core/errors.js";
import { OAUTH_REDIRECT } from "../youtube/oauthFlow.js";

const body = z.object({
  clientId: z.string().trim().min(1, "Client ID is required"),
  clientSecret: z.string().trim().min(1, "Client secret is required"),
  refreshToken: z.string().trim().min(1, "Refresh token is required"),
});

/**
 * Optional override client for the in-app OAuth flow. Both fields are required together — an empty
 * body means "use the bundled client". Secrets are write-only; only booleans are ever read back.
 */
const oauthStartBody = z
  .object({
    clientId: z.string().trim().min(1),
    clientSecret: z.string().trim().min(1),
  })
  .partial()
  .refine((b) => (b.clientId ? Boolean(b.clientSecret) : !b.clientSecret), {
    message: "Both client ID and secret are required to use your own credentials",
  });

interface SetupDeps {
  store: JsonStore;
  /** Whether the server booted with working credentials (drives the setup screen). */
  configured: boolean;
  /** Re-boots the server so newly-saved credentials take effect. */
  requestRestart: () => void;
  /**
   * In-app OAuth flow (PRD-03 §2), present only when the host can open the system browser
   * (Electron). Absent in headless/Docker boots, where the connect endpoint reports unavailable.
   */
  oauth?: {
    /** Whether a bundled OAuth client shipped with this build (one-click connect available). */
    hasBundledClient: boolean;
    /**
     * Runs the loopback consent flow, persists the refresh token, and hot-applies the creds.
     * An override client (the operator's own ID/secret) takes precedence over the bundled one.
     */
    run: (override?: { clientId: string; clientSecret: string }) => Promise<void>;
  };
}

/**
 * First-run / re-auth setup for the desktop build. GET reports whether credentials are present;
 * POST saves them to the store and triggers a server restart so the YouTube client is rebuilt.
 * POST /oauth/start runs the in-app OAuth flow instead of pasting a token by hand. The refresh
 * token is write-only — it is never returned to the client.
 */
export function setupRouter({ store, configured, requestRestart, oauth }: SetupDeps): Router {
  const router = Router();

  router.get("/status", (_req, res) => {
    const c = store.get().credentials;
    res.json({
      configured,
      // Booleans only — secrets never leave the server.
      hasClientId: Boolean(c.clientId),
      hasClientSecret: Boolean(c.clientSecret),
      hasRefreshToken: Boolean(c.refreshToken),
      // Whether the one-click in-app OAuth flow can run in this build/host.
      hasBundledClient: Boolean(oauth?.hasBundledClient),
      canConnect: Boolean(oauth),
      // The loopback redirect the operator must register on their own OAuth client (override flow).
      redirectUri: OAUTH_REDIRECT,
    });
  });

  // In-app OAuth: opens the system browser, catches the loopback code, stores the refresh token,
  // and hot-rebuilds the YouTube client. A body carrying the operator's own client ID/secret runs
  // the flow against that client (override, PRD-03 §3); an empty body uses the bundled client.
  // Only the ok/error status is returned — never the token.
  router.post("/oauth/start", async (req, res) => {
    if (!oauth) {
      res
        .status(501)
        .json(
          toErrorBody(
            new AppError(
              "OAUTH_FAILED",
              "In-app sign-in isn't available in this build — configure credentials via env or the CLI.",
            ),
          ),
        );
      return;
    }
    try {
      const parsed = oauthStartBody.parse(req.body ?? {});
      const override =
        parsed.clientId && parsed.clientSecret
          ? { clientId: parsed.clientId, clientSecret: parsed.clientSecret }
          : undefined;
      await oauth.run(override);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json(toErrorBody(new AppError("INVALID_REQUEST", err.issues[0]?.message)));
        return;
      }
      res.status(400).json(toErrorBody(err));
    }
  });

  router.post("/", async (req, res) => {
    try {
      const creds = body.parse(req.body);
      await store.update((s) => {
        s.credentials = creds;
      });
      // Respond first, then restart — the restart is deferred so this response flushes.
      res.json({ ok: true, restarting: true });
      requestRestart();
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json(toErrorBody(new AppError("INVALID_REQUEST", err.issues[0]?.message)));
        return;
      }
      res.status(400).json(toErrorBody(err));
    }
  });

  return router;
}
