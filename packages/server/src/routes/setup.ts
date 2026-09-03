import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { JsonStore } from "../storage/jsonStore.js";
import { AppError, toErrorBody } from "../core/errors.js";
import { noteAudit } from "../audit/middleware.js";
import { OAUTH_REDIRECT } from "../youtube/oauthFlow.js";
import { deriveActiveFlow } from "../youtube/setupStatus.js";
import { resetEligibility } from "../youtube/eligibility.js";

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

export interface SetupDeps {
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
    /** The bundled client's ID, used only to tell the bundled flow apart from an override. */
    bundledClientId?: string;
    /**
     * Runs the loopback consent flow, persists the refresh token, and hot-applies the creds.
     * An override client (the operator's own ID/secret) takes precedence over the bundled one.
     */
    run: (override?: { clientId: string; clientSecret: string }) => Promise<void>;
  };
  /**
   * Hosted (redirect) connect flow (issue 052, PRD-15 §5), present only when the deployment knows
   * its own public origin. The loopback flow above cannot run here: consent happens in the admin's
   * *own* browser, on another machine, and Google redirects it back to this origin.
   */
  hosted?: {
    /** The redirect URI to register on the Google client. Reported in status so it can be copied. */
    redirectUri: string;
    /** Issues a state nonce and returns the consent URL for the admin's browser to visit. */
    authorize: (override?: { clientId: string; clientSecret: string }) => { url: string };
    /** Validates the returning callback, exchanges the code, and hot-applies the credentials. */
    complete: (params: { code?: string; state?: string; error?: string }) => Promise<void>;
  };
}

/**
 * First-run / re-auth setup for the desktop build. GET reports whether credentials are present;
 * POST saves them to the store and triggers a server restart so the YouTube client is rebuilt.
 * POST /oauth/start runs the in-app OAuth flow instead of pasting a token by hand. The refresh
 * token is write-only — it is never returned to the client.
 */
/**
 * Whether the app is connected, as booleans. Exported apart from the router because it is mounted
 * apart from it: the rest of `/api/setup` is admin-only (issue 045), while this is read by every
 * signed-in browser — the setup gate and the connection card are both built on it, and a user
 * who could not read it would face a dashboard that cannot say why nothing works. It carries no
 * secret and no way to change anything.
 */
export function setupStatusHandler({ store, configured, oauth, hosted }: SetupDeps): RequestHandler {
  return (_req, res) => {
    const c = store.get().credentials;
    res.json({
      configured,
      // Booleans only — secrets never leave the server.
      hasClientId: Boolean(c.clientId),
      hasClientSecret: Boolean(c.clientSecret),
      hasRefreshToken: Boolean(c.refreshToken),
      // Whether the one-click in-app OAuth flow can run in this build/host.
      hasBundledClient: Boolean(oauth?.hasBundledClient),
      // How consent can be run from here, if at all. The two flows are not interchangeable and
      // the dashboard has to drive them differently — `in-app` is a POST the server holds open
      // while it drives the local browser; `redirect` hands the browser a URL and gets it back
      // through the callback. A single boolean could not tell them apart (issue 052).
      connectMode: hosted ? "redirect" : oauth ? "in-app" : null,
      // Which flow currently backs the app (bundled/override/env), or null when not configured.
      activeFlow: deriveActiveFlow(c, { configured, bundledClientId: oauth?.bundledClientId }),
      // The redirect URI to register on the OAuth client — for whichever flow is actually live
      // here. It is copied by hand into the Google console, so it must be the real one: the
      // loopback address on a desktop host, the public callback on a hosted one.
      redirectUri: hosted ? hosted.redirectUri : OAUTH_REDIRECT,
      // Whether YouTube lets this channel create broadcasts (issue 061). Setup status, not health:
      // it describes the channel's permissions, and nothing here is a reason to reconnect.
      liveEligibility: store.get().liveEligibility,
    });
  };
}

/**
 * Hosted connect, step two: Google sends the admin's browser here. This is a **navigation**, not
 * a fetch — a JSON error body would land the admin on a page of machine text — so every outcome
 * is a redirect back to the dashboard, which reads the query and says what happened. The token
 * never appears in either: it goes to the store, and only `ok` or a message comes back out.
 *
 * Exported apart from the router because it is mounted apart from it (issue 052 review): the rest
 * of `/api/setup` sits behind `requireAdmin()`, whose refusals are JSON — which is the one body
 * this route promises never to produce. app.ts mounts it ahead of that with a guard that refuses
 * in the same currency the route answers in, a redirect.
 */
export function setupCallbackHandler({ hosted }: SetupDeps): RequestHandler {
  return async (req, res) => {
    const back = (params: Record<string, string>) =>
      res.redirect(`/?${new URLSearchParams(params).toString()}`);
    if (!hosted) {
      back({ connect_error: "Browser sign-in isn't available on this deployment." });
      return;
    }
    const q = req.query as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    try {
      await hosted.complete({ code: str(q.code), state: str(q.state), error: str(q.error) });
      // The credential change happens here, on a GET, so the trail is told what this was rather
      // than left to infer it from a 302 that looks identical on the way out (issue 050).
      noteAudit(req, { action: "connected YouTube", notable: true });
      back({ connected: "youtube" });
    } catch (err) {
      noteAudit(req, { action: "failed to connect YouTube", notable: false });
      back({
        connect_error:
          err instanceof AppError ? err.message : "The YouTube sign-in did not complete.",
      });
    }
  };
}

export function setupRouter(deps: SetupDeps): Router {
  const { store, configured, requestRestart, oauth, hosted } = deps;
  const router = Router();

  // Also served here, so the router remains a complete unit for its own tests and for any host
  // that mounts it alone. In the app the mount in app.ts answers first — see mountBootRoutes.
  router.get("/status", setupStatusHandler(deps));

  // Disconnect (issue 014): wipe the stored credentials and reboot into setup mode. Reversible
  // only by reconnecting — the refresh token is discarded, so YouTube access stops immediately.
  // Env/CLI-supplied credentials live outside the store and are surfaced as read-only guidance,
  // so this route is only reached from the desktop connection settings.
  router.post("/disconnect", async (_req, res) => {
    await store.update((s) => {
      s.credentials = { clientId: "", clientSecret: "", refreshToken: "" };
    });
    // What YouTube allows was learned about the channel we just disconnected from; the next
    // connect may well be a different channel (issue 061).
    await resetEligibility(store);
    res.json({ ok: true, restarting: true });
    requestRestart();
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

  // Hosted connect, step one (issue 052): hand the admin a consent URL to visit. Their browser
  // does the navigating, so unlike /oauth/start this returns immediately and the request does not
  // stay open across a human deciding things. An override client is accepted the same way.
  router.post("/oauth/authorize", (req, res) => {
    if (!hosted) {
      res
        .status(501)
        .json(
          toErrorBody(
            new AppError(
              "OAUTH_FAILED",
              "Browser sign-in isn't available on this deployment — set PUBLIC_ORIGIN, or configure credentials via env or the CLI.",
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
      // The URL only — the state nonce it carries is the server's, and there is nothing here for
      // the browser to hold on to.
      res.json(hosted.authorize(override));
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json(toErrorBody(new AppError("INVALID_REQUEST", err.issues[0]?.message)));
        return;
      }
      res.status(400).json(toErrorBody(err));
    }
  });

  // Kept here too, so the router stays a complete unit for its own tests and for any host that
  // mounts it alone — the mount in app.ts answers first in the app itself, as it does for /status.
  router.get("/oauth/callback", setupCallbackHandler(deps));

  router.post("/", async (req, res) => {
    try {
      const creds = body.parse(req.body);
      await store.update((s) => {
        s.credentials = creds;
      });
      // Same reasoning as /disconnect: these credentials may belong to another channel, and on a
      // headless host this route is the only way in — `connectYouTube`'s reset never runs there
      // (issue 061).
      await resetEligibility(store);
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
