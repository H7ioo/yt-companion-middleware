import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { loadConfig } from "./config.js";
import { JsonStore } from "./storage/jsonStore.js";
import { createYouTubeClient } from "./youtube/client.js";
import { StateCache } from "./core/stateCache.js";
import { ActionRunner } from "./core/actionRunner.js";
import { QuotaTracker, instrumentQuota } from "./core/quota.js";
import { StateEvents } from "./core/events.js";
import { WebhookDispatcher } from "./core/webhook.js";
import type { AppContext } from "./routes/context.js";
import { actionRouter } from "./routes/action.js";
import { feedbackRouter } from "./routes/feedback.js";
import { presetsRouter } from "./routes/presets.js";
import { settingsRouter } from "./routes/settings.js";
import { stateRouter } from "./routes/state.js";
import { categoriesRouter } from "./routes/categories.js";
import { streamsRouter } from "./routes/streams.js";
import { webhookRouter } from "./routes/webhook.js";
import { streamHandler } from "./routes/stream.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const store = new JsonStore(config.storePath);
  await store.init();

  const events = new StateEvents();
  const quota = new QuotaTracker(store, config.quotaLimit, events);
  quota.init();
  const yt = instrumentQuota(createYouTubeClient(config), quota);
  const cache = new StateCache(
    yt,
    store,
    {
      refreshIntervalMs: config.refreshIntervalMs,
      healthFailureThreshold: config.healthFailureThreshold,
    },
    events,
  );
  const runner = new ActionRunner(yt, store, cache, events);
  const ctx: AppContext = { store, runner, cache, yt, quota, events, regionCode: config.regionCode };

  const webhooks = new WebhookDispatcher(store, cache, runner, quota, events);

  const app = express();
  app.use(express.json());

  // Liveness check — unauthenticated (PRD §5.2 exempts /health).
  app.get("/api/feedback/health", (_req, res) => {
    const c = cache.snapshot();
    const q = quota.snapshot();
    res.json({
      status: c.health,
      authenticated: c.health !== "auth_error",
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
  // Live SSE stream so the dashboard reacts instantly instead of polling.
  app.get("/api/dashboard/stream", streamHandler(ctx));
  // Alias to the same handler so Companion buttons on either path keep working.
  app.use("/api/dashboard/action", actionRouter(ctx));

  // Interactive API console — a self-contained page that documents every route and can
  // fire test requests against this server (same-origin, so the fetch tester just works).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const docsPage = path.resolve(here, "../public/docs.html");
  app.get("/docs", (_req, res) => res.sendFile(docsPage));

  // Serve the built React dashboard, if present.
  const webDist = path.resolve(here, "../web/dist");
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  cache.start();
  webhooks.start();

  app.listen(config.port, () => {
    console.log(`[server] listening on http://0.0.0.0:${config.port}`);
    console.log(`[server] data store: ${config.storePath}`);
  });

  const shutdown = () => {
    cache.stop();
    webhooks.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
