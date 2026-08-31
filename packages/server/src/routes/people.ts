import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { JsonStore } from "../storage/jsonStore.js";
import { removeAccount, setRole } from "../auth/accounts.js";
import { inviteState } from "../auth/invites.js";
import type { Auth } from "../auth/actor.js";
import { AppError, toErrorBody } from "../core/errors.js";
import type { Account, Invite } from "../storage/schema.js";
import type { DeviceSession, InviteSummary, Person } from "@app/shared";

/**
 * Who is on this deployment, who is an admin, who is still holding an invite, and who gets cut
 * off (issue 045 for the roles, issue 046 for the rest; PRD-15 §1–§2).
 *
 * Mounted behind the admin guard, not guarding itself: the mount in app.ts is where "admin only"
 * is stated once, next to every other route's answer to the same question, so the list of
 * admin-only routes can be audited as a table rather than read out of twelve routers.
 *
 * The one half of issue 046 that is *not* here is redemption — see `routes/auth.ts`. A person
 * following an invite link has no session yet, so it cannot live behind this guard.
 */

const roleBody = z.object({ role: z.enum(["admin", "user"]) });
const inviteBody = z.object({ role: z.enum(["admin", "user"]).default("user") });

export interface PeopleDeps {
  store: JsonStore;
  auth: Auth;
}

/** The account fields a client may see. The password hash is not among them. */
function publicPerson(account: Account): Person {
  return {
    id: account.id,
    name: account.name,
    role: account.role,
    createdAt: account.createdAt,
    seeded: account.seeded,
  };
}

/**
 * The invite fields a client may see. Not among them: `tokenHash`. The token itself is returned
 * exactly once, from the create call, and is not recoverable — an admin who loses the link makes
 * another invite rather than looking the old one up.
 */
function publicInvite(invite: Invite, accounts: Account[], now: number): InviteSummary {
  const nameOf = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? null;
  return {
    id: invite.id,
    role: invite.role,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    invitedBy: nameOf(invite.createdBy),
    state: inviteState(invite, now),
    redeemedBy: nameOf(invite.redeemedBy),
  };
}

/** One device, named by nothing but its clocks — see {@link DeviceSession}. */
function publicSession(session: {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  absoluteExpiresAt: string;
}): DeviceSession {
  return {
    id: session.id,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
  };
}

export function peopleRouter({ store, auth }: PeopleDeps): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ accounts: store.get().accounts.map(publicPerson) });
  });

  router.put("/:id/role", handler(async (req, res) => {
    const { role } = roleBody.parse(req.body);
    const account = await setRole(store, req.params.id, role);
    res.json({ account: publicPerson(account) });
  }));

  /** Every invite this deployment has a record of, with the spent ones marked as such. */
  router.get("/invites", handler(async (_req, res) => {
    const now = Date.now();
    const accounts = store.get().accounts;
    res.json({ invites: auth.invites.list().map((i) => publicInvite(i, accounts, now)) });
  }));

  /**
   * Creates an invite. The token comes back **once**, here, and is never returned again — the
   * admin copies the link out of this response and hands it over. There is no mail server and
   * this route does not send anything.
   */
  router.post("/invites", handler(async (req, res) => {
    const { role } = inviteBody.parse(req.body);
    const actor = auth.actorOf(req);
    // On a deployment with no accounts the admin guard is a pass-through, so this route would be
    // open to anyone who can reach the port — and minting one admin invite there is enough to
    // redeem it through the deliberately-open `/api/auth/invite`, flip auth on, and lock the real
    // operator (and the Companion module) out of an install that has no seed config to recover
    // with. Sign-in has to exist before invitations to it can.
    if (!auth.required || !actor) {
      throw new AppError(
        "FORBIDDEN",
        "This deployment has no accounts yet, so there is no sign-in to invite anyone to.",
      );
    }
    const created = await auth.invites.create({ role, createdBy: actor.account.id });
    const accounts = store.get().accounts;
    res.status(201).json({
      token: created.token,
      /** Path rather than a full URL: only the browser knows the origin this host is reached at. */
      path: invitePath(created.token),
      invite: publicInvite(created.invite, accounts, Date.now()),
    });
  }));

  /** Withdraws an unredeemed invite. */
  router.delete("/invites/:id", handler(async (req, res) => {
    await auth.invites.cancel(req.params.id);
    res.json({ ok: true });
  }));

  /**
   * Cuts an account off. {@link removeAccount} drops its sessions in the same write, and session
   * resolution independently refuses a session whose account is gone — so the cut-off is on the
   * very next request either way, not whenever the session happens to lapse (PRD-15 §2).
   *
   * The seeded admin is refused: it is the account the deployment's configuration recreates at
   * every boot, so removing it deletes a person who reappears on restart — and the last-admin
   * rule below would be the only thing standing between that and a locked-out workspace.
   */
  router.delete("/:id", handler(async (req, res) => {
    const target = store.get().accounts.find((a) => a.id === req.params.id);
    if (target?.seeded) {
      throw new AppError(
        "FORBIDDEN",
        `${target.name} was set up at install and cannot be removed here.`,
      );
    }
    const removed = await removeAccount(store, req.params.id);
    res.json({ account: publicPerson(removed) });
  }));

  /** The devices one account is signed in on, so an admin can cut off the lost one. */
  router.get("/:id/sessions", handler(async (req, res) => {
    mustExist(store, req.params.id);
    res.json({ sessions: auth.sessions.listFor(req.params.id).map(publicSession) });
  }));

  /**
   * Revokes **one** device. The account's other sessions are untouched — that is the whole point
   * of the route, and the reason a 90-day session lifetime is acceptable at all.
   */
  router.delete("/:id/sessions/:sessionId", handler(async (req, res) => {
    mustExist(store, req.params.id);
    const revoked = await auth.sessions.revokeById(req.params.id, req.params.sessionId);
    if (!revoked) throw new AppError("INVALID_REQUEST", "That device is no longer signed in.");
    res.json({ ok: true });
  }));

  return router;
}

/** The dashboard route an invite link points at. Shared with the web app through the contract. */
export function invitePath(token: string): string {
  return `/invite?token=${encodeURIComponent(token)}`;
}

/** Rejects a path whose account id names nobody, so a typo cannot read as "no sessions". */
function mustExist(store: JsonStore, accountId: string): void {
  if (!store.get().accounts.some((a) => a.id === accountId)) {
    throw new AppError("INVALID_REQUEST", "No such account.");
  }
}

/**
 * Wraps a handler so every refusal in this router is reported the same way, in one place.
 *
 * The three-way split matters: a `FORBIDDEN` is a 403 because no amount of retrying or
 * re-authenticating makes it succeed (the last-admin rule, the seeded admin) — a second admin
 * does. Anything else that is an {@link AppError} is the caller asking wrongly, so a 400. And
 * anything that is *not* an AppError is this server failing — a store write that could not land,
 * say — where reporting a 400 with its own message mislabels the fault and hands the caller the
 * store's filesystem path.
 */
function handler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    void fn(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      if (err instanceof z.ZodError) {
        res
          .status(400)
          .json(toErrorBody(new AppError("INVALID_REQUEST", "Role must be admin or user.")));
        return;
      }
      if (!(err instanceof AppError)) {
        console.error("[people] request failed:", err);
        res.status(500).json(toErrorBody(new AppError("SERVER_ERROR")));
        return;
      }
      res.status(err.code === "FORBIDDEN" ? 403 : 400).json(toErrorBody(err));
    });
  };
}
