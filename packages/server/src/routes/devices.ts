import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { JsonStore } from "../storage/jsonStore.js";
import type { Auth } from "../auth/actor.js";
import { AppError, toErrorBody } from "../core/errors.js";
import type { Account, DeviceToken } from "../storage/schema.js";
import type { DeviceTokenSummary } from "@app/shared";

/**
 * Device tokens, and the grace-mode readout beside them (issue 047, PRD-15 §2 and §4).
 *
 * Mounted behind the admin guard — stated once in `ADMIN_ONLY` in app.ts, not repeated here — for
 * the reason that guard exists: minting a credential is how a deployment loses control of itself,
 * and a device token that could mint another would be an admin with extra steps.
 *
 * The grace readout lives here rather than in a panel of its own because it answers a question
 * only this page can act on: *is every machine on a token yet, and is it safe to turn the switch?*
 * Both halves of the evidence are on the same screen as the tokens themselves.
 */

const createBody = z.object({ name: z.string().min(1).max(120) });

export interface DeviceDeps {
  store: JsonStore;
  auth: Auth;
}

/**
 * The token fields a client may see. Not among them: `tokenHash`. The plaintext comes back once,
 * from the create call, and is not recoverable — an admin who loses it revokes and makes another.
 */
function publicToken(token: DeviceToken, accounts: Account[]): DeviceTokenSummary {
  return {
    id: token.id,
    name: token.name,
    createdAt: token.createdAt,
    createdBy: accounts.find((a) => a.id === token.createdBy)?.name ?? null,
    lastUsedAt: token.lastUsedAt,
    revokedAt: token.revokedAt,
  };
}

export function devicesRouter({ store, auth }: DeviceDeps): Router {
  const router = Router();

  /** Every device token, revoked ones included — the revoked rows are half the audit trail. */
  router.get("/", (_req, res) => {
    const accounts = store.get().accounts;
    res.json({ tokens: auth.devices.list().map((t) => publicToken(t, accounts)) });
  });

  /**
   * Whether it is safe to turn grace mode off: both counters, and the verdict that needs both.
   * Read before the flip in issue 049, and rendered as a standing warning while anything is
   * still connecting the old way.
   */
  router.get("/grace", (_req, res) => {
    res.json(auth.grace.readout());
  });

  /**
   * Mints a token. It comes back **once**, here, and never again — the admin copies it into the
   * module's config and that is the only copy. There is no "show token" route to add later: the
   * server keeps a hash, so there is nothing to show.
   */
  router.post("/", handler(async (req, res) => {
    const { name } = createBody.parse(req.body);
    const actor = auth.actorOf(req);
    // On a deployment with no accounts the admin guard is a pass-through, so this route would be
    // open to anyone who can reach the port — and a token minted there is a credential nobody
    // asked for on an install that never opted into authentication. Same reasoning as invites.
    if (!auth.required || !actor) {
      throw new AppError(
        "FORBIDDEN",
        "This deployment has no accounts yet, so there is nothing for a device token to authenticate against.",
      );
    }
    const created = await auth.devices.create({ name, createdBy: actor.account.id });
    res.status(201).json({
      token: created.token,
      device: publicToken(created.record, store.get().accounts),
    });
  }));

  /**
   * Cuts one machine off. The next request it makes is refused, and its live socket is dropped —
   * a token revoked while a socket stays open is a revocation that does not take effect until the
   * machine happens to reconnect, which on a Companion box is "never".
   */
  router.delete("/:id", handler(async (req, res) => {
    const revoked = await auth.devices.revoke(req.params.id);
    auth.announceDeviceRevoked(revoked.id);
    res.json({ device: publicToken(revoked, store.get().accounts) });
  }));

  return router;
}

/**
 * The same three-way split the people router uses: `FORBIDDEN` is a 403 (retrying changes
 * nothing), any other {@link AppError} is the caller asking wrongly, and anything else is this
 * server failing — reported as a 500 rather than handing the caller the store's filesystem path.
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
          .json(toErrorBody(new AppError("INVALID_REQUEST", "Give the machine a name.")));
        return;
      }
      if (!(err instanceof AppError)) {
        console.error("[devices] request failed:", err);
        res.status(500).json(toErrorBody(new AppError("SERVER_ERROR")));
        return;
      }
      res.status(err.code === "FORBIDDEN" ? 403 : 400).json(toErrorBody(err));
    });
  };
}
