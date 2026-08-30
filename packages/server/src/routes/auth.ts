import { Router } from "express";
import { z } from "zod";
import type { SessionInfo } from "@app/shared";
import { clearSessionCookie, readCookie, SESSION_COOKIE, setSessionCookie, type Auth } from "../auth/actor.js";
import { AppError, toErrorBody } from "../core/errors.js";

/**
 * Sign-in, sign-out, and "who am I" (issue 043).
 *
 * Mounted in server.ts *before* the setup-mode catch-all, not in mountApiRoutes: on a hosted
 * deployment the person who has to finish setup is the person who has to sign in first, and a
 * server without YouTube credentials must still be able to authenticate them.
 */

const credentials = z.object({
  name: z.string().min(1).max(200),
  password: z.string().min(1).max(1024),
});

/** The account fields a client may see. The password hash is not among them. */
function publicAccount(account: { id: string; name: string; role: "admin" | "user" }) {
  return { id: account.id, name: account.name, role: account.role };
}

export function authRouter(auth: Auth): Router {
  const router = Router();

  /** The dashboard's first call: does this deployment authenticate, and am I signed in? */
  router.get("/me", async (req, res) => {
    const actor = auth.required ? await auth.currentActor(req) : null;
    const info: SessionInfo = {
      authRequired: auth.required,
      authenticated: Boolean(actor),
      account: actor ? publicAccount(actor.account) : null,
      expiringSoon: actor?.expiringSoon ?? false,
      absoluteExpiresAt: actor?.absoluteExpiresAt ?? null,
    };
    res.json(info);
  });

  router.post("/login", async (req, res) => {
    let parsed;
    try {
      parsed = credentials.parse(req.body);
    } catch (err) {
      const message = err instanceof z.ZodError ? err.issues[0]?.message : undefined;
      res.status(400).json(toErrorBody(new AppError("INVALID_REQUEST", message)));
      return;
    }

    const result = await auth.signIn(parsed.name, parsed.password, callerIp(req));
    if (!result.ok && result.reason === "throttled") {
      const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      res.setHeader("Retry-After", String(seconds));
      res.status(429).json(
        toErrorBody(
          new AppError(
            "TOO_MANY_ATTEMPTS",
            `Too many sign-in attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).`,
          ),
        ),
      );
      return;
    }
    if (!result.ok) {
      // One message for both a wrong password and an account that does not exist: the response
      // must not tell a stranger which usernames are real.
      res
        .status(401)
        .json(toErrorBody(new AppError("INVALID_CREDENTIALS", "Incorrect username or password.")));
      return;
    }

    setSessionCookie(req, res, result.token);
    res.json({ account: publicAccount(result.account) });
  });

  router.post("/logout", async (req, res) => {
    await auth.sessions.revoke(readCookie(req.headers.cookie, SESSION_COOKIE));
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  /**
   * Trades an approaching-the-cap session for a fresh one. Requires a still-valid session — this
   * is a convenience for a browser that is already signed in, not a second way to sign in.
   */
  router.post("/reauth", async (req, res) => {
    const renewed = await auth.sessions.reauthenticate(
      readCookie(req.headers.cookie, SESSION_COOKIE),
    );
    if (!renewed) {
      res
        .status(401)
        .json(toErrorBody(new AppError("UNAUTHENTICATED", "Sign in to continue.")));
      return;
    }
    setSessionCookie(req, res, renewed.token);
    res.json({ ok: true, absoluteExpiresAt: renewed.session.absoluteExpiresAt });
  });

  return router;
}

/**
 * The caller's address for throttling purposes. `req.ip` already honours a trusted proxy when
 * express is configured for one; the raw socket address is the fallback for a direct connection.
 */
function callerIp(req: { ip?: string; socket: { remoteAddress?: string } }): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}
