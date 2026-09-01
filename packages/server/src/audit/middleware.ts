import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AuditActor } from "@app/shared";
import type { Auth } from "../auth/actor.js";
import type { AuditLog } from "./log.js";

/**
 * The audit trail as one middleware rather than a line remembered inside twenty routers (issue
 * 050, PRD-15 §3).
 *
 * Written this way for the same reason the session guard is a prefix guard: the default for a
 * route added next month has to be "recorded". A per-route `audit.record(…)` is a thing to
 * forget, and the one route somebody forgets is the one an admin comes looking for.
 *
 * It records on `finish`, so the entry carries what actually happened — a refusal is as much a
 * part of the record as a success, and the guard has by then resolved the caller onto the request,
 * which is what lets this name a device token by its name instead of "unknown".
 */

/** Methods that change something. A GET is a read, and reads are the feed's business, not this. */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface AuditTrailDeps {
  audit: AuditLog;
  auth: Auth;
}

export function auditTrail({ audit, auth }: AuditTrailDeps): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // Lowercased for the prefix test only: Express routes case-insensitively by default, so
    // `/API/Dashboard/...` reaches the same handler and has to reach the log the same way. The
    // path stored below is still the one the caller actually used.
    if (!MUTATING.has(req.method) || !req.path.toLowerCase().startsWith("/api/")) {
      next();
      return;
    }
    // The path as called, without the query string: a query is where a token would be if anyone
    // ever put one there, and the audit log is the last place that should keep a copy.
    const calledPath = req.originalUrl.split("?")[0];
    // Captured now: a handler is free to reassign req.body, and the entry should describe what
    // was asked for, not what the handler left behind.
    const body: unknown = req.body;

    // Once, on the response finishing. Not on `close`, which also fires for a client that hung
    // up mid-request — an aborted request is not an action anybody took.
    res.once("finish", () => {
      audit.record({
        actor: actorOf(auth, req),
        method: req.method,
        path: calledPath,
        status: res.statusCode,
        body,
        ...namedTarget(calledPath, body),
      });
    });
    next();
  };
}

/**
 * Who the guard decided was asking. Read from the request rather than resolved again: the guard
 * memoizes the caller there, so this costs nothing and — importantly — cannot slide a session's
 * idle clock a second time after the response has gone.
 */
export function actorOf(auth: Auth, req: Request): AuditActor {
  const caller = auth.callerOf(req);
  if (!caller) return { kind: "anonymous", id: null, name: "anonymous" };
  if (caller.kind === "device") {
    return { kind: "machine", id: caller.token.id, name: caller.token.name };
  }
  return { kind: "person", id: caller.actor.account.id, name: caller.actor.account.name };
}

/**
 * The two routes whose actor is anonymous by definition — signing in, and redeeming an invite —
 * carry the name that was attempted as their target. Without it the record of a hosted
 * deployment's sign-ins would be a column of "anonymous signed in", which answers nothing.
 *
 * The name is not a secret; the password beside it is, and {@link redact} never lets it through.
 */
function namedTarget(path: string, body: unknown): { target?: string | null } {
  // Lowercased for the same reason the prefix test is: Express does not care about the casing,
  // so neither can this.
  const route = path.toLowerCase().replace(/\/+$/, "");
  if (route !== "/api/auth/login" && route !== "/api/auth/invite") return {};
  const name = (body as { name?: unknown } | null | undefined)?.name;
  return { target: typeof name === "string" ? name : null };
}
