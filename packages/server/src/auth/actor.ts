import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { JsonStore } from "../storage/jsonStore.js";
import type { Account } from "../storage/schema.js";
import { authenticate, seedAdmin, type SeedConfig } from "./accounts.js";
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

/** Requests carry their resolved actor here once the guard (or a lookup) has run. */
const ACTOR = Symbol.for("app.actor");

interface WithActor extends Request {
  [ACTOR]?: Actor | null;
}

export class Auth {
  readonly sessions: Sessions;
  private readonly store: JsonStore;
  private readonly throttle: LoginThrottle;

  constructor(store: JsonStore, now: () => number = Date.now) {
    this.store = store;
    this.sessions = new Sessions(store, now);
    this.throttle = new LoginThrottle(now);
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
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const actor = await this.sessions.resolve(token);
    carrier[ACTOR] = actor;
    return actor;
  }

  /** The actor already resolved for this request, without touching the store again. */
  actorOf(req: Request): Actor | null {
    return (req as WithActor)[ACTOR] ?? null;
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
        const actor = await this.currentActor(req);
        if (!actor) {
          res.status(401).json(toErrorBody(new AppError("UNAUTHENTICATED")));
          return;
        }
        next();
      })().catch(next);
    };
  }
}

/**
 * Writes the session cookie. `httpOnly` keeps it away from script, `sameSite=lax` means an
 * arbitrary page cannot make a signed-in browser fire an action at this server, and `secure` is
 * set whenever the request arrived over TLS — including through a proxy, which is how every
 * hosted request arrives (PRD-15: Cloudflare terminates TLS and the origin speaks plain HTTP).
 * It is left off for plain-HTTP LAN and localhost, where a secure cookie would simply be dropped.
 */
export function setSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure(req),
    path: "/",
    maxAge: IDLE_MS,
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

function isSecure(req: Request): boolean {
  const forwarded = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return req.secure || proto?.split(",")[0]?.trim() === "https";
}
