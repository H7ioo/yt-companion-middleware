import type { Express } from "express";
import type { AppContext } from "./routes/context.js";
import { actionRouter } from "./routes/action.js";
import { feedbackRouter } from "./routes/feedback.js";
import { presetsRouter } from "./routes/presets.js";
import { settingsRouter } from "./routes/settings.js";
import { stateRouter } from "./routes/state.js";
import { categoriesRouter } from "./routes/categories.js";
import { streamsRouter } from "./routes/streams.js";
import { webhookRouter } from "./routes/webhook.js";
import { serviceRouter } from "./routes/service.js";
import { logsRouter } from "./routes/logs.js";
import { streamHandler } from "./routes/stream.js";
import { fillRequestRouter, notifyRouter } from "./routes/fillRequest.js";

/**
 * Mounts every API route that exists once the server has working credentials. Kept apart from
 * server.ts (which owns config, the YouTube client, the poll loop and the HTTP/WS server) so the
 * route table itself — mount paths included — is what the integration tests exercise, rather than
 * a hand-rolled copy of it that can drift (PRD-05 §2.1).
 *
 * The setup routes are not here: they mount in server.ts before this, because they must also
 * answer in setup mode, where there is no AppContext.
 */
export function mountApiRoutes(app: Express, ctx: AppContext): void {
  // Liveness check — unauthenticated (PRD §5.2 exempts /health).
  app.get("/api/feedback/health", (_req, res) => {
    const c = ctx.cache.snapshot();
    const q = ctx.quota.snapshot();
    res.json({
      status: c.health,
      authenticated: c.health !== "auth_error",
      apiEnabled: ctx.store.get().service.apiEnabled,
      message: c.healthMessage,
      quotaUsed: q.used,
      quotaLimit: q.limit,
      quotaRemaining: q.remaining,
    });
  });

  // Companion-facing endpoints — unauthenticated (LAN-only personal tool, PRD §8).
  app.use("/api/action", actionRouter(ctx));
  app.use("/api/feedback", feedbackRouter(ctx));
  // SSE stream — an alternative to polling for any custom integration.
  app.get("/api/feedback/stream", streamHandler(ctx));

  // Dashboard management endpoints.
  app.use("/api/dashboard/presets", presetsRouter(ctx));
  app.use("/api/dashboard/settings", settingsRouter(ctx));
  app.use("/api/dashboard/state", stateRouter(ctx));
  app.use("/api/dashboard/categories", categoriesRouter(ctx));
  app.use("/api/dashboard/streams", streamsRouter(ctx));
  app.use("/api/dashboard/webhook", webhookRouter(ctx));
  app.use("/api/dashboard/service", serviceRouter(ctx));
  app.use("/api/dashboard/logs", logsRouter(ctx));
  // Companion key → dashboard-popup/phone-push fill flow (issue 003 trigger).
  app.use("/api/dashboard/fill-request", fillRequestRouter(ctx));
  app.use("/api/dashboard/notify", notifyRouter(ctx));
  // Live SSE stream so the dashboard reacts instantly instead of polling.
  app.get("/api/dashboard/stream", streamHandler(ctx));
  // Same handler under a dashboard-namespaced base. The split is by caller, not
  // legacy: /api/action/* is the Companion base, /api/dashboard/action/* is the
  // dashboard base. Both are intentional and supported (issue 027).
  app.use("/api/dashboard/action", actionRouter(ctx));
}
