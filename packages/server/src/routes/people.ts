import { Router } from "express";
import { z } from "zod";
import type { JsonStore } from "../storage/jsonStore.js";
import { setRole } from "../auth/accounts.js";
import { AppError, toErrorBody } from "../core/errors.js";
import type { Person } from "@app/shared";

/**
 * Who is on this deployment, and who is an admin (issue 045, PRD-15 §1).
 *
 * Mounted behind the admin guard, not guarding itself: the mount in app.ts is where "admin only"
 * is stated once, next to every other route's answer to the same question, so the list of
 * admin-only routes can be audited as a table rather than read out of twelve routers.
 *
 * Adding and removing people is issue 046's half — this slice is the roles.
 */

const roleBody = z.object({ role: z.enum(["admin", "user"]) });

export interface PeopleDeps {
  store: JsonStore;
}

/** The account fields a client may see. The password hash is not among them. */
function publicPerson(account: {
  id: string;
  name: string;
  role: "admin" | "user";
  createdAt: string;
  seeded: boolean;
}): Person {
  return {
    id: account.id,
    name: account.name,
    role: account.role,
    createdAt: account.createdAt,
    seeded: account.seeded,
  };
}

export function peopleRouter({ store }: PeopleDeps): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ accounts: store.get().accounts.map(publicPerson) });
  });

  router.put("/:id/role", (req, res) => {
    void (async () => {
      try {
        const { role } = roleBody.parse(req.body);
        const account = await setRole(store, req.params.id, role);
        res.json({ account: publicPerson(account) });
      } catch (err) {
        if (err instanceof z.ZodError) {
          res
            .status(400)
            .json(toErrorBody(new AppError("INVALID_REQUEST", "Role must be admin or user.")));
          return;
        }
        // The last-admin refusal arrives here as FORBIDDEN — a 403, because no amount of retrying
        // or re-authenticating makes it succeed; a second admin does.
        const status = err instanceof AppError && err.code === "FORBIDDEN" ? 403 : 400;
        res.status(status).json(toErrorBody(err));
      }
    })();
  });

  return router;
}
