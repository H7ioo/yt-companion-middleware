import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { loadConfig, resolveCredentials, isConfigured, type AppConfig } from "./config.js";
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
import { serviceRouter } from "./routes/service.js";
import { setupRouter } from "./routes/setup.js";
import { streamHandler } from "./routes/stream.js";
import { attachStateSocket } from "./routes/socket.js";

/** A running HTTP server that can be gracefully torn down (used for restart-on-setup). */
interface BootHandle {
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Boots the Express app once against the current config + store. When credentials are present
 * the full middleware (YouTube client, poll loop, webhooks, all routes) is wired; otherwise the
 * server comes up in "setup mode" — only the setup + health routes and the static dashboard are
 * served, and every other API call returns 503 SETUP_REQUIRED. `requestRestart` re-boots the
 * server after the setup screen saves credentials.
 */
async function bootOnce(
  config: AppConfig,
  store: JsonStore,
  requestRestart: () => void,
): Promise<BootHandle> {
  const creds = resolveCredentials(config, store.get().credentials);
  const configured = isConfigured(creds);

  const app = express();
  app.use(express.json());

  // Setup endpoints are always available so the desktop app can be configured at runtime.
  app.use("/api/setup", setupRouter({ store, configured, requestRestart }));

  // Pieces that only exist once we have credentials — captured for graceful shutdown.
  let cache: StateCache | null = null;
  let webhooks: WebhookDispatcher | null = null;
  let wss: { close(): void } | null = null;
  let ctx: AppContext | null = null;

  if (configured) {
    const events = new StateEvents();
    const quota = new QuotaTracker(store, config.quotaLimit, events);
    quota.init();
    const yt = instrumentQuota(
      createYouTubeClient({ ...config, youtube: creds }),
      quota,
    );
    cache = new StateCache(
      yt,
      store,
      {
        refreshIntervalMs: config.refreshIntervalMs,
        healthFailureThreshold: config.healthFailureThreshold,
      },
      events,
    );
    const runner = new ActionRunner(yt, store, cache, events);
    ctx = { store, runner, cache, yt, quota, events, regionCode: config.regionCode };

    webhooks = new WebhookDispatcher(store, cache, runner, quota, events);

    // Liveness check — unauthenticated (PRD §5.2 exempts /health).
    app.get("/api/feedback/health", (_req, res) => {
      const c = cache!.snapshot();
      const q = quota.snapshot();
      res.json({
        status: c.health,
        authenticated: c.health !== "auth_error",
        apiEnabled: store.get().service.apiEnabled,
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
    // Live SSE stream so the dashboard reacts instantly instead of polling.
    app.get("/api/dashboard/stream", streamHandler(ctx));
    // Alias to the same handler so Companion buttons on either path keep working.
    app.use("/api/dashboard/action", actionRouter(ctx));

    cache.start();
    webhooks.start();
  } else {
    // Setup mode: report the pending-setup state on the health probe so Companion (and the
    // dashboard) can tell the difference between "misconfigured" and "not yet set up".
    app.get("/api/feedback/health", (_req, res) => {
      res.json({
        status: "setup_required",
        authenticated: false,
        apiEnabled: false,
        setupRequired: true,
        message: "YouTube credentials not configured — open the app to finish setup.",
      });
    });

    // Every other API call is unavailable until credentials are saved.
    app.use("/api", (_req, res) => {
      res
        .status(503)
        .json({ error: { code: "SETUP_REQUIRED", message: "Finish setup before using the API." } });
    });
  }

  // Interactive API console — a self-contained page that documents every route and can
  // fire test requests against this server (same-origin, so the fetch tester just works).
  const docsPage = path.resolve(here, "../public/docs.html");
  app.get("/docs", (_req, res) => res.sendFile(docsPage));

  // Operator manual — API + web UI + Bitfocus Companion setup, including the redirect flow.
  const guidePage = path.resolve(here, "../public/guide.html");
  app.get("/guide", (_req, res) => res.sendFile(guidePage));

  // Serve the built React dashboard, if present.
  const webDist = path.resolve(here, "../packages/web/dist");
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(config.port, () => {
      const mode = configured ? "ready" : "SETUP REQUIRED";
      console.log(`[server] listening on http://0.0.0.0:${config.port} (${mode})`);
      console.log(`[server] data store: ${config.storePath}`);
      resolve();
    });
  });

  // WebSocket push (Companion prefers WS); SSE and polling remain available. Only meaningful
  // once configured — in setup mode there is no state to push.
  if (ctx) {
    wss = attachStateSocket(server, ctx);
  }

  let closed = false;
  return {
    async close() {
      if (closed) return;
      closed = true;
      cache?.stop();
      webhooks?.stop();
      wss?.close();
      // Drop keep-alive sockets so the port frees immediately for the restart.
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Starts the middleware server with restart-on-setup support. Returns a handle that shuts the
 * current server down. Used both by the CLI entrypoint and by the Electron main process.
 */
export async function startServer(): Promise<BootHandle> {
  const config = loadConfig();
  const store = new JsonStore(config.storePath);
  await store.init();

  let current: BootHandle | null = null;
  let restarting = false;

  const requestRestart = (): void => {
    if (restarting) return;
    restarting = true;
    // Defer so the in-flight setup response can flush before we tear the server down.
    setTimeout(() => {
      void (async () => {
        try {
          await current?.close();
          current = await bootOnce(config, store, requestRestart);
          console.log("[server] restarted after credential change");
        } catch (err) {
          console.error("[server] restart failed:", err);
        } finally {
          restarting = false;
        }
      })();
    }, 250);
  };

  current = await bootOnce(config, store, requestRestart);

  return {
    async close() {
      await current?.close();
    },
  };
}

// Direct CLI / Docker entrypoint. Electron imports startServer() instead of running this.
const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  startServer()
    .then((handle) => {
      const shutdown = () => {
        void handle.close().then(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((err) => {
      console.error("[server] fatal:", err);
      process.exit(1);
    });
}
