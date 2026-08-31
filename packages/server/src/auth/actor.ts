import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { JsonStore } from "../storage/jsonStore.js";
import type { Account, DeviceToken } from "../storage/schema.js";
import { authenticate, seedAdmin, type SeedConfig } from "./accounts.js";
import { Invites } from "./invites.js";
import { DeviceTokens } from "./deviceTokens.js";
import { Grace } from "./grace.js";
import { IDLE_MS, Sessions, type Actor } from "./sessions.js";
import { LoginThrottle } from "./throttle.js";
import { AppError, toErrorBody } from "../core/errors.js";

/**
 * The identity spine (issue 043): one object that answers "who is asking?", so issues 044, 047
 * and 050 extend this seam rather than each inventing their own.
 *
 * Authentication is **dormant until an admin is seeded**. The desktop and LAN deployments this
 * app ships as today configure no admin, so {@link Auth.required} is false, the guard passes
 * every caller through, and nothing about their install changes. Setting the admin environment
 * variables is what turns the whole chain on — which is exactly the hosted deployment's boot.
 */

/** Session cookie name. Prefixed like everything else this app puts in a browser. */
export const SESSION_COOKIE = "yt_session";

/** Reads one cookie out of a raw `Cookie` header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

/**
 * Who is asking, once a guard has decided (issue 047 widens issue 043's seam).
 *
 * Two kinds, and the difference is the point. A **person** signs in and gets a session; a
 * **machine** presents a device token from a config file on a shared desk. Both authenticate, so
 * both satisfy {@link Auth.requireSession} — the Companion module calls five `/api/dashboard/*`
 * routes and would otherwise go dark on a seeded deployment. Only a person can be an admin: a
 * device caller is refused by {@link Auth.requireAdmin} whatever route it arrives on.
 */
export type Caller =
  | { kind: "session"; actor: Actor }
  | { kind: "device"; token: DeviceToken };

/** Requests carry their resolved caller here once the guard (or a lookup) has run. */
const ACTOR = Symbol.for("app.actor");
const CALLER = Symbol.for("app.caller");
/** Set once the Companion guard has recorded this request as tokenless, so it counts once. */
const RECORDED = Symbol.for("app.graceRecorded");

interface WithActor extends Request {
  [ACTOR]?: Actor | null;
  [CALLER]?: Caller | null;
  [RECORDED]?: boolean;
}

/**
 * The device token on a request, from `Authorization: Bearer …`.
 *
 * A header, not a query parameter: a token in a URL lands in every access log and proxy log
 * between the machine and here. The same reader serves the WebSocket upgrade, which carries real
 * headers too (the `ws` client's handshake options are where issue 048 puts it).
 */
export function readBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1].trim() || undefined;
}

export class Auth {
  readonly sessions: Sessions;
  /** Invites — the only way an account other than the seeded admin comes into being (issue 046). */
  readonly invites: Invites;
  /** Credentials for machines, which are never admins (issue 047). */
  readonly devices: DeviceTokens;
  /** Grace mode and the evidence for ending it (issue 047; issue 049 flips the switch). */
  readonly grace: Grace;
  private readonly store: JsonStore;
  private readonly throttle: LoginThrottle;
  private readonly now: () => number;

  constructor(store: JsonStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
    this.sessions = new Sessions(store, now);
    this.invites = new Invites(store, now);
    this.devices = new DeviceTokens(store, now);
    this.grace = new Grace(store, now);
    this.throttle = new LoginThrottle(now);
  }

  /**
   * Watchers notified when a device token is revoked. The socket layer subscribes: a revocation
   * that only takes effect on the next *request* never takes effect at all on a Companion box,
   * which opens one WebSocket and holds it for weeks.
   */
  private readonly revocationWatchers = new Set<(tokenId: string) => void>();

  /** Subscribe to device-token revocations; returns an unsubscribe function. */
  onDeviceRevoked(watcher: (tokenId: string) => void): () => void {
    this.revocationWatchers.add(watcher);
    return () => this.revocationWatchers.delete(watcher);
  }

  /** Announces a revocation. Called by the route that performs one, after the write has landed. */
  announceDeviceRevoked(tokenId: string): void {
    for (const watcher of this.revocationWatchers) {
      // One bad watcher must not stop the others from cutting their sockets.
      try {
        watcher(tokenId);
      } catch (err) {
        console.error("[auth] device-revocation watcher failed:", err);
      }
    }
  }

  /** Seeds the configured admin at boot. See {@link seedAdmin}. */
  async seed(seed: SeedConfig | null): Promise<Account | null> {
    return seedAdmin(this.store, seed);
  }

  /**
   * Whether this deployment authenticates at all. False for a store with no accounts — the
   * desktop/LAN case — where guarding anything would lock out an operator who has no way in.
   */
  get required(): boolean {
    return this.store.get().accounts.length > 0;
  }

  /**
   * Resolves the caller, refreshing their idle clock. Returns null for an anonymous caller.
   * Memoized per request, so several guards on one route do not each rewrite the session record.
   */
  async currentActor(req: Request): Promise<Actor | null> {
    const carrier = req as WithActor;
    if (carrier[ACTOR] !== undefined) return carrier[ACTOR];
    const actor = await this.actorOfCookies(req.headers.cookie);
    carrier[ACTOR] = actor;
    return actor;
  }

  /**
   * Resolves the caller from a raw `Cookie` header. The WebSocket upgrade never runs express
   * middleware — it is served off the bare HTTP server — so the socket guard asks this directly
   * instead of going through {@link requireSession} (issue 044).
   */
  async actorOfCookies(header: string | undefined): Promise<Actor | null> {
    return this.sessions.resolve(readCookie(header, SESSION_COOKIE));
  }

  /** The actor already resolved for this request, without touching the store again. */
  actorOf(req: Request): Actor | null {
    return (req as WithActor)[ACTOR] ?? null;
  }

  /**
   * Resolves whoever is asking — a signed-in person or a machine holding a device token (issue
   * 047). Memoized per request like {@link currentActor}, so several guards on one route do not
   * each rewrite the session record or the token's last-use stamp.
   *
   * The session is tried first. A browser that is signed in *and* somehow carrying a bearer
   * header is a person, and reporting them as a machine would silently drop their admin rights
   * halfway through a page.
   */
  async currentCaller(req: Request): Promise<Caller | null> {
    const carrier = req as WithActor;
    if (carrier[CALLER] !== undefined) return carrier[CALLER];
    const actor = await this.currentActor(req);
    let caller: Caller | null = actor ? { kind: "session", actor } : null;
    if (!caller) {
      const token = await this.devices.verify(readBearer(req.headers.authorization));
      if (token) caller = { kind: "device", token };
    }
    carrier[CALLER] = caller;
    return caller;
  }

  /** The caller already resolved for this request, without touching the store again. */
  callerOf(req: Request): Caller | null {
    return (req as WithActor)[CALLER] ?? null;
  }

  /**
   * Resolves a caller off a WebSocket upgrade, which runs no express middleware and so has no
   * request object to memoize on — just the raw headers the handshake carried.
   */
  async callerOfHeaders(headers: {
    cookie?: string;
    authorization?: string;
  }): Promise<Caller | null> {
    const actor = await this.actorOfCookies(headers.cookie);
    if (actor) return { kind: "session", actor };
    const token = await this.devices.verify(readBearer(headers.authorization));
    return token ? { kind: "device", token } : null;
  }

  /**
   * Signs someone in, subject to the throttle. Returns the session token, or the reason it was
   * refused — `invalid` never distinguishes a wrong password from an account that does not exist.
   */
  async signIn(
    name: string,
    password: string,
    callerIp: string,
  ): Promise<
    | { ok: true; token: string; account: Account }
    | { ok: false; reason: "invalid" }
    | { ok: false; reason: "throttled"; retryAfterMs: number }
  > {
    // Keyed on caller *and* name: a shared NAT must not let one attacker lock a colleague out,
    // and guessing many names from one address must not get a fresh budget for each.
    const key = `${callerIp}|${name.toLowerCase()}`;
    const verdict = this.throttle.check(key);
    if (!verdict.allowed) return { ok: false, reason: "throttled", retryAfterMs: verdict.retryAfterMs };

    const account = await authenticate(this.store, name, password);
    if (!account) {
      this.throttle.recordFailure(key);
      return { ok: false, reason: "invalid" };
    }
    this.throttle.reset(key);
    const { token } = await this.sessions.create(account.id);
    return { ok: true, token, account };
  }

  /**
   * Guards a route. Passes every caller through when the deployment has no accounts, so mounting
   * it can never lock out an install that never opted into authentication.
   */
  requireSession(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        if (!this.required) {
          next();
          return;
        }
        // A device token satisfies this guard as a session does. The Companion module calls five
        // routes under `/api/dashboard` — presets, categories, streams, service, fill-request —
        // and a guard that only understood cookies would take a *correctly configured*, token
        // carrying module dark on a seeded deployment (the note left in issue 044).
        const caller = await this.currentCaller(req);
        if (!caller) {
          res.status(401).json(toErrorBody(new AppError("UNAUTHENTICATED")));
          return;
        }
        if (caller.kind === "session") this.slideCookie(req, res, caller.actor);
        next();
      })().catch(next);
    };
  }

  /**
   * Guards the Companion-facing endpoints — `/api/action`, `/api/feedback` and their socket
   * (issue 047). Three answers, in order:
   *
   * 1. A valid credential — a device token, or a signed-in browser — passes.
   * 2. A device token that was *presented and rejected* — revoked, expired, mistyped — is refused
   *    outright, grace mode or not. Grace mode exists for the module that cannot send a token at
   *    all; a caller that sent one is past that, and letting a revoked token fall through to the
   *    tokenless path would make revocation a no-op on the two endpoints that matter and let the
   *    socket reconnect the moment the 4401 cut it.
   * 3. No credential at all, **grace mode on**: passes, and the connection is recorded. The
   *    module in the field has no token field until issue 048, so refusing here is the go-dark
   *    outage PRD-15 §4 describes.
   * 4. No credential, enforcement on (issue 049): refused.
   *
   * Recording is what keeps step 2 from being authentication quietly switched off forever: every
   * tokenless connection resets the exit condition's two counters and names itself in the
   * dashboard's standing warning.
   */
  requireCompanion(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        if (!this.required) {
          next();
          return;
        }
        const caller = await this.currentCaller(req);
        if (caller) {
          if (caller.kind === "session") this.slideCookie(req, res, caller.actor);
          next();
          return;
        }
        // A rejected token is not the same silence grace mode covers — see (2) above.
        if (readBearer(req.headers.authorization) || this.grace.enforcing) {
          res.status(401).json(toErrorBody(new AppError("UNAUTHENTICATED")));
          return;
        }
        // Recorded once per request, whatever the mount table does. `/api/feedback/stream` matches
        // both the `/api/feedback` mount and its own `app.get`, and a guard that ran twice counted
        // one Companion connection as two in the number the exit condition is read from.
        const carrier = req as WithActor;
        if (carrier[RECORDED]) {
          next();
          return;
        }
        carrier[RECORDED] = true;
        await this.grace.recordTokenless({
          client: req.headers["user-agent"] ?? null,
          from: req.ip ?? req.socket.remoteAddress ?? null,
          route: req.baseUrl ? `${req.baseUrl}${req.path}` : req.path,
        });
        next();
      })().catch(next);
    };
  }

  /**
   * Guards a route that only an admin may reach (issue 045). Mounted *after* {@link requireSession},
   * which is what turns "no session" into a 401; reaching here with no actor still refuses, so the
   * order can never be the difference between closed and open.
   *
   * The refusal is a 403, never a 401. A 401 sends the dashboard to the login screen, and signing
   * in again as the same person answers the same way — the caller is known, and the answer is no.
   *
   * Dormant with the rest of authentication: a deployment with no accounts has no admins either,
   * and the single operator of a desktop install would otherwise be locked out of their own setup.
   */
  requireAdmin(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        if (!this.required) {
          next();
          return;
        }
        const caller = await this.currentCaller(req);
        if (!caller) {
          res.status(401).json(toErrorBody(new AppError("UNAUTHENTICATED")));
          return;
        }
        // A device token is never an admin, and there is no role on one to check: it lives in a
        // config file on a shared machine, so it runs the show and nothing else. Refused here
        // rather than by giving tokens a role, so no future token can be minted into an admin.
        if (caller.kind === "device") {
          res.status(403).json(
            toErrorBody(
              new AppError("FORBIDDEN", "A device token cannot administer this deployment."),
            ),
          );
          return;
        }
        if (caller.actor.account.role !== "admin") {
          res.status(403).json(toErrorBody(new AppError("FORBIDDEN")));
          return;
        }
        next();
      })().catch(next);
    };
  }

  /**
   * Re-stamps the cookie's expiry to match the session's refreshed idle clock. The server slides
   * its own 30-day window on every authenticated request; without this the browser would still
   * discard the cookie 30 days after sign-in, so an active session would die at day 30 and the
   * 90-day cap — and the notice that warns about it — would never be reached.
   */
  slideCookie(req: Request, res: Response, actor: Actor): void {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) return;
    // Never past the absolute cap: the cookie should die with the session, not outlive it.
    const untilCap = Date.parse(actor.absoluteExpiresAt) - this.now();
    setSessionCookie(req, res, token, Math.min(IDLE_MS, untilCap));
  }
}

/**
 * Writes the session cookie. `httpOnly` keeps it away from script, `sameSite=lax` means an
 * arbitrary page cannot make a signed-in browser fire an action at this server, and `secure` is
 * set whenever the request arrived over TLS — including through a *trusted* proxy, which is how
 * every hosted request arrives (PRD-15: Cloudflare terminates TLS and the origin speaks plain
 * HTTP). It is left off for plain-HTTP LAN and localhost, where a secure cookie would be dropped.
 *
 * `maxAge` mirrors the server-side idle window, and is rewritten on every authenticated request
 * (see {@link Auth.slideCookie}) so an actively used session is not dropped by the browser while
 * the server still considers it live. It never outlives the absolute cap.
 */
export function setSessionCookie(
  req: Request,
  res: Response,
  token: string,
  maxAge: number = IDLE_MS,
): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure(req),
    path: "/",
    maxAge: Math.max(1000, maxAge),
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure(req),
    path: "/",
  });
}

/**
 * `req.secure` is express's own answer, and it already reads `X-Forwarded-Proto` — but only when
 * `trust proxy` says the hop may be believed. Reading the header directly would let any caller
 * claim TLS on a server that trusts nobody, so this defers to express and nothing else.
 */
function isSecure(req: Request): boolean {
  return req.secure;
}
