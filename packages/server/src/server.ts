import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import type { youtube_v3 } from "googleapis";
import { loadConfig, resolveCredentials, isConfigured, type AppConfig } from "./config.js";
import type { CredentialsState } from "./storage/schema.js";
import { JsonStore } from "./storage/jsonStore.js";
import { createYouTubeClient } from "./youtube/client.js";
import { connectYouTube } from "./youtube/connect.js";
import { StateCache } from "./core/stateCache.js";
import { ActionRunner } from "./core/actionRunner.js";
import { QuotaTracker, instrumentQuota } from "./core/quota.js";
import { StateEvents } from "./core/events.js";
import { Logger } from "./core/logger.js";
import { WebhookDispatcher } from "./core/webhook.js";
import type { AppContext } from "./routes/context.js";
import { mountApiRoutes } from "./app.js";
import { setupRouter } from "./routes/setup.js";
import { attachStateSocket } from "./routes/socket.js";

/** A running HTTP server that can be gracefully torn down (used for restart-on-setup). */
interface BootHandle {
  close(): Promise<void>;
}

/**
 * Capabilities the host process injects. The Electron main process supplies these so the in-app
 * OAuth flow (PRD-03 §2) can open the system browser; a headless/Docker boot omits them and the
 * flow is unavailable (operators use env/CLI instead).
 */
export interface StartServerOptions {
  /** Opens a URL in the system browser (shell.openExternal under Electron). */
  openBrowser?: (url: string) => void | Promise<void>;
  /** Build-time bundled OAuth client, if the shipped binary carries one (PRD-03 §1.1). */
  bundledClient?: { clientId: string; clientSecret: string };
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
  options: StartServerOptions = {},
): Promise<BootHandle> {
  const creds = resolveCredentials(config, store.get().credentials);
  const configured = isConfigured(creds);

  const app = express();
  app.use(express.json());

  // How newly-connected credentials take effect. Default is a full reboot (first-run: there is no
  // credentialed subsystem yet). Once configured, the block below swaps this for a hot rebuild that
  // keeps the HTTP server — and Companion's connection — up (PRD-03 §2.4, "no server restart").
  let applyCredentials: (creds: CredentialsState) => void | Promise<void> = () => requestRestart();

  // The in-app OAuth flow needs a way to open the system browser; only the Electron host provides
  // it. Late-bound `applyCredentials` so the hot-rebuild path (set below) is used once configured.
  const oauth = options.openBrowser
    ? {
        hasBundledClient: Boolean(
          options.bundledClient?.clientId && options.bundledClient?.clientSecret,
        ),
        bundledClientId: options.bundledClient?.clientId,
        run: (override?: { clientId: string; clientSecret: string }) =>
          connectYouTube({
            store,
            override,
            bundledClient: options.bundledClient,
            openBrowser: options.openBrowser!,
            applyCredentials: (c) => applyCredentials(c),
          }),
      }
    : undefined;

  // Setup endpoints are always available so the desktop app can be configured at runtime.
  app.use("/api/setup", setupRouter({ store, configured, requestRestart, oauth }));

  // Pieces that only exist once we have credentials — captured for graceful shutdown.
  let cache: StateCache | null = null;
  let webhooks: WebhookDispatcher | null = null;
  let wss: { close(): void } | null = null;
  let ctx: AppContext | null = null;

  if (configured) {
    const events = new StateEvents();
    // In-memory activity feed (PRD-06 §3). Producers below push into it; the dashboard reads it
    // via GET /api/dashboard/logs. Not persisted — a restart starts the feed fresh.
    const logger = new Logger();
    const quota = new QuotaTracker(store, config.quotaLimit, events, logger);
    quota.init();
    // A stable proxy handed to every consumer (cache, runner, routes). Rebuilding on reconnect
    // swaps `activeClient` underneath it, so the YouTube client is replaced in-process with no
    // restart and no dangling references (PRD-03 §2.4). Every call site reads `yt.liveBroadcasts`
    // (etc.) fresh, so the swap is picked up on the next call.
    let activeClient = instrumentQuota(createYouTubeClient({ ...config, youtube: creds }), quota);
    const yt = new Proxy({} as youtube_v3.Youtube, {
      get: (_t, prop) => activeClient[prop as keyof youtube_v3.Youtube],
    });
    applyCredentials = (newCreds) => {
      activeClient = instrumentQuota(
        createYouTubeClient({ ...config, youtube: newCreds }),
        quota,
      );
      // Re-evaluate health immediately so a successful reconnect clears an auth_error banner.
      void cache?.refresh();
    };
    cache = new StateCache(
      yt,
      store,
      {
        refreshIntervalMs: config.refreshIntervalMs,
        healthFailureThreshold: config.healthFailureThreshold,
      },
      events,
      logger,
    );
    const runner = new ActionRunner(yt, store, cache, events, logger);
    ctx = { store, runner, cache, yt, quota, events, logger, regionCode: config.regionCode };

    webhooks = new WebhookDispatcher(store, cache, runner, quota, events);

    // The whole credentialed route table (health, Companion, dashboard, dual alias) — see app.ts.
    mountApiRoutes(app, ctx);

    cache.start();
    webhooks.start();
    logger.push({
      level: "info",
      category: "system",
      code: null,
      message: "Middleware started — polling YouTube",
    });
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
  const webDist = path.resolve(here, "../../web/dist");
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
export async function startServer(options: StartServerOptions = {}): Promise<BootHandle> {
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
          current = await bootOnce(config, store, requestRestart, options);
          console.log("[server] restarted after credential change");
        } catch (err) {
          console.error("[server] restart failed:", err);
        } finally {
          restarting = false;
        }
      })();
    }, 250);
  };

  current = await bootOnce(config, store, requestRestart, options);

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
