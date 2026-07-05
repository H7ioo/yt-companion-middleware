import { Router } from "express";
import type { AppContext } from "./context.js";
import { regenerateToken, tokenStatus } from "../auth/apiToken.js";

/** API token management (PRD §5.2, §8.4). */
export function tokenRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(tokenStatus(ctx.store));
  });

  // Returns the plaintext token exactly once. The operator copies it into Companion's
  // connection header; the old token is invalidated immediately.
  router.post("/regenerate", async (_req, res) => {
    const token = await regenerateToken(ctx.store);
    res.json({ token, ...tokenStatus(ctx.store) });
  });

  return router;
}
