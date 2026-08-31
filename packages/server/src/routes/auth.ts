import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
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
  router.get("/me", handler(async (req, res) => {
    const actor = auth.required ? await auth.currentActor(req) : null;
    if (actor) auth.slideCookie(req, res, actor);
    const info: SessionInfo = {
      authRequired: auth.required,
      authenticated: Boolean(actor),
      account: actor ? publicAccount(actor.account) : null,
      expiringSoon: actor?.expiringSoon ?? false,
      absoluteExpiresAt: actor?.absoluteExpiresAt ?? null,
    };
    res.json(info);
  }));

  router.post("/login", handler(async (req, res) => {
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
  }));

  /**
   * What is behind this invite link, without spending it (issue 046).
   *
   * Deliberately unauthenticated — the person following the link has no session yet, which is the
   * whole reason invites exist. It reveals only the role the invite carries and when it lapses:
   * nothing about who else is on this deployment, and never the token back. A wrong or spent
   * token gets the same clear sentence a redemption would, so the page can say "this link has
   * expired" on arrival instead of after someone has typed a password twice.
   */
  router.get("/invite", handler(async (req, res) => {
    try {
      const invite = auth.invites.inspect(inviteToken(req));
      res.json({ ok: true, role: invite.role, expiresAt: invite.expiresAt });
    } catch (err) {
      const appError = asAppError(err);
      // 410 only for the link itself being spent or stale. A server fault is not a dead end, and
      // telling the invitee it is one costs them an invite that is still good.
      res.status(appError.code === "INVITE_INVALID" ? 410 : 500).json(toErrorBody(appError));
    }
  }));

  /**
   * Spends an invite: the invitee sets their own credential and is signed straight in, because
   * being bounced to a login screen to retype the password they just chose is a step that only
   * exists to be got wrong.
   *
   * The **role comes from the invite**, never from this body — a link sent to a camera operator
   * must not be a way to ask for admin.
   */
  router.post("/invite", handler(async (req, res) => {
    let parsed;
    try {
      parsed = credentials.parse(req.body);
    } catch (err) {
      const message = err instanceof z.ZodError ? err.issues[0]?.message : undefined;
      res.status(400).json(toErrorBody(new AppError("INVALID_REQUEST", message)));
      return;
    }

    let account;
    try {
      account = await auth.invites.redeem(inviteToken(req), parsed);
    } catch (err) {
      const appError = asAppError(err);
      // 410 for the link itself being spent or stale, 400 for the form — the page shows the first
      // as a dead end and the second as something to correct and try again.
      res.status(appError.code === "INVITE_INVALID" ? 410 : 400).json(toErrorBody(appError));
      return;
    }

    // Signed in as the account that was just created rather than by re-running signIn: the
    // password is already known good, and re-checking it would put a brand-new account one
    // throttle bucket away from being unable to finish its own redemption.
    const { token } = await auth.sessions.create(account.id);
    setSessionCookie(req, res, token);
    res.status(201).json({ account: publicAccount(account) });
  }));

  router.post("/logout", handler(async (req, res) => {
    await auth.sessions.revoke(readCookie(req.headers.cookie, SESSION_COOKIE));
    clearSessionCookie(req, res);
    res.json({ ok: true });
  }));

  /**
   * Trades an approaching-the-cap session for a fresh one. Requires a still-valid session — this
   * is a convenience for a browser that is already signed in, not a second way to sign in.
   */
  router.post("/reauth", handler(async (req, res) => {
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
  }));

  // Whatever {@link handler} catches lands here: a JSON body in this app's shape, and a 500
  // rather than express's default HTML page — the dashboard only ever parses JSON.
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    console.error("[auth] request failed:", err);
    res.status(500).json(toErrorBody(new AppError("SERVER_ERROR")));
  });

  return router;
}

/**
 * Wraps an async handler so a rejected promise becomes a 500 instead of an unhandled rejection.
 * Every route here writes to the store, and express 4 does not catch a handler's rejection: a
 * read-only data directory or a full disk would otherwise take the whole process down.
 */
function handler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

/**
 * The caller's address for throttling purposes. `req.ip` already honours a trusted proxy when
 * express is configured for one; the raw socket address is the fallback for a direct connection.
 */
function callerIp(req: { ip?: string; socket: { remoteAddress?: string } }): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * The invite token, taken from the query string rather than the path. A path segment lands in
 * access logs and proxy logs as part of the URL either way, but keeping it a parameter means the
 * dashboard's own routing never has to treat a secret as a route.
 */
function inviteToken(req: Request): string | undefined {
  const token = req.query.token;
  return typeof token === "string" && token ? token : undefined;
}

/** Anything the invite layer throws that is not already an {@link AppError} is this server failing. */
function asAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  console.error("[auth] invite failed:", err);
  return new AppError("SERVER_ERROR");
}
