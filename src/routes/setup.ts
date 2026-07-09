import { Router } from "express";
import { z } from "zod";
import type { JsonStore } from "../storage/jsonStore.js";
import { AppError, toErrorBody } from "../core/errors.js";

const body = z.object({
  clientId: z.string().trim().min(1, "Client ID is required"),
  clientSecret: z.string().trim().min(1, "Client secret is required"),
  refreshToken: z.string().trim().min(1, "Refresh token is required"),
});

interface SetupDeps {
  store: JsonStore;
  /** Whether the server booted with working credentials (drives the setup screen). */
  configured: boolean;
  /** Re-boots the server so newly-saved credentials take effect. */
  requestRestart: () => void;
}

/**
 * First-run / re-auth setup for the desktop build. GET reports whether credentials are present;
 * POST saves them to the store and triggers a server restart so the YouTube client is rebuilt.
 * The refresh token is write-only — it is never returned to the client.
 */
export function setupRouter({ store, configured, requestRestart }: SetupDeps): Router {
  const router = Router();

  router.get("/status", (_req, res) => {
    const c = store.get().credentials;
    res.json({
      configured,
      // Booleans only — secrets never leave the server.
      hasClientId: Boolean(c.clientId),
      hasClientSecret: Boolean(c.clientSecret),
      hasRefreshToken: Boolean(c.refreshToken),
    });
  });

  router.post("/", async (req, res) => {
    try {
      const creds = body.parse(req.body);
      await store.update((s) => {
        s.credentials = creds;
      });
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
