import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import type { AppContext } from "./routes/context.js";
import { actionRouter } from "./routes/action.js";
import { feedbackRouter } from "./routes/feedback.js";
import { presetsRouter } from "./routes/presets.js";
import { settingsRouter } from "./routes/settings.js";
import { stateRouter } from "./routes/state.js";
import { categoriesRouter } from "./routes/categories.js";
import { streamsRouter } from "./routes/streams.js";
import { targetRouter } from "./routes/target.js";
import { broadcastsRouter } from "./routes/broadcasts.js";
import { ingestionRouter } from "./routes/ingestion.js";
import { webhookRouter } from "./routes/webhook.js";
import { serviceRouter } from "./routes/service.js";
import { logsRouter } from "./routes/logs.js";
import { streamHandler } from "./routes/stream.js";
import { fillRequestRouter, notifyRouter } from "./routes/fillRequest.js";
import { setupRouter, setupStatusHandler, type SetupDeps } from "./routes/setup.js";
import { appInfoRouter, type AppInfoDeps } from "./routes/appInfo.js";
import { authRouter } from "./routes/auth.js";
import { peopleRouter } from "./routes/people.js";
import { devicesRouter } from "./routes/devices.js";
import { auditRouter } from "./routes/audit.js";
import type { Auth } from "./auth/actor.js";
import { auditTrail, type AuditTrailDeps } from "./audit/middleware.js";

/**
 * Mounts that answer without a session, each for a stated reason (issue 044).
 *
 * This is the list the route-table audit in `guard.integration.test.ts` checks the *real* mounted
 * app against: a route that is neither behind the guard nor named here fails CI rather than
 * shipping open. Adding an entry is therefore a deliberate, reviewable act — which is the point.
 *
 * Express mounts only. A WebSocket upgrade never runs express middleware, so the sockets carry
 * their own table with the same shape — see `WS_ROUTES` in routes/socket.ts, which the same audit
 * walks.
 */
export const GUARD_EXEMPTIONS: ReadonlyArray<{ mount: string; why: string }> = [
  {
    mount: "/api/auth",
    why: "Sign-in itself. A guard here is a door locked from the inside.",
  },
  {
    mount: "/api/feedback/health",
    why: "Companion reads it as a liveness probe, before any credential exists (PRD-15 §6).",
  },
  {
    mount: "/api/action",
    why:
      "Companion-facing, and behind requireCompanion() rather than open: a device token is " +
      "accepted, and a tokenless caller is accepted *and recorded* only while grace mode is on " +
      "(issue 047). The module in the field has no token field at all until issue 048, so a hard " +
      "refusal here today is the go-dark outage PRD-15 §4 describes. Issue 049 flips the switch.",
  },
  {
    mount: "/api/feedback",
    why: "Companion-facing, behind requireCompanion() for the same reason as /api/action.",
  },
  {
    mount: "/api/feedback/stream",
    why: "The Companion-side SSE feed — an alternative to polling /api/feedback, same reasoning.",
  },
  {
    mount: "/guide",
    why: "The static operator manual. No account data, and it is what an operator reads when locked out.",
  },
  {
    mount: "/docs",
    why: "The static API console page. The endpoints it calls are guarded on their own merits.",
  },
  {
    mount: "SPA",
    why: "The dashboard bundle's catch-all — it serves the login page itself (PRD-15 §6).",
  },
];

/**
 * Mounts only an admin may reach (issue 045, PRD-15 §1).
 *
 * The dividing line the PRD draws: **if getting it wrong means a bad stream it is a user action;
 * if it means losing control of the channel or the server it is admin.** Everything absent from
 * this table is therefore deliberately open to both roles — running the show is what a user
 * account is *for*, and a per-feature permission here would be the second workspace PRD-15 §1
 * refuses to build.
 *
 * Stated once, here, rather than as a guard remembered inside twelve routers: the role audit in
 * `guard.integration.test.ts` walks the real route table against this list, so an admin guard
 * added without an entry — or an entry with no guard — fails CI either way.
 */
export const ADMIN_ONLY: ReadonlyArray<{ mount: string; why: string }> = [
  {
    mount: "/api/setup",
    why:
      "Connect and disconnect YouTube. Getting this wrong loses the channel, not one stream — " +
      "and it accepts a Google client ID and secret. Read-only status is mounted separately, " +
      "ahead of this, and stays open to both roles.",
  },
  {
    mount: "/api/dashboard/people",
    why: "Who is here and who is an admin. A machine or a user account must not be able to grant itself more.",
  },
  {
    mount: "/api/dashboard/audit",
    why:
      "Who did what, on this deployment, for the last ninety days (issue 050). It names every " +
      "account and every machine attached to the server, and it is the record of the admin " +
      "actions themselves — reading it is the 'losing control of the server' side of the line.",
  },
  {
    mount: "/api/dashboard/devices",
    why:
      "Minting and revoking machine credentials, and the grace-mode evidence beside them " +
      "(issue 047). A device token that could mint another would be an admin with extra steps.",
  },
];

/**
 * Mounts the audit trail (issue 050, PRD-15 §3).
 *
 * Called **before** every route mount, boot routes included, and that ordering is load-bearing:
 * the middleware registers a `finish` listener on the way in, so a route mounted ahead of it —
 * sign-in, setup, connecting YouTube — would answer without ever being recorded.
 *
 * Mounted at the root rather than at `/api`, so it stays out of the route table the guard audit
 * walks: it is middleware like `express.json`, not an endpoint, and it filters to `/api/` itself.
 */
export function mountAuditTrail(app: Express, deps: AuditTrailDeps): void {
  app.use(auditTrail(deps));
}

/**
 * Routes that must answer in *both* boot modes: before YouTube credentials exist and after. Kept
 * here rather than inline in server.ts so the audit test can mount the real thing, guards
 * included, instead of a hand-rolled copy that can drift (PRD-05 §2.1).
 *
 * `/api/setup` and `/api/dashboard/app` are guarded. On a hosted deployment the admin is seeded,
 * never claimed, so setup belongs to that admin and to nobody who merely found the host first
 * (PRD-15 §2) — and to that admin alone, not to every signed-in account (issue 045; see
 * {@link ADMIN_ONLY}). On a desktop/LAN install no account exists, both guards are pass-throughs,
 * and nothing about first run changes.
 */
export function mountBootRoutes(
  app: Express,
  deps: { auth: Auth; setup: SetupDeps; appInfo: AppInfoDeps },
): void {
  app.use("/api/auth", authRouter(deps.auth));
  // Connection status is the one readable half: booleans, no secrets, and the whole dashboard is
  // built on it (see setupStatusHandler). Registered before the mount below so the admin guard
  // there cannot swallow it, and audited as a mount of its own.
  app.get("/api/setup/status", deps.auth.requireSession(), setupStatusHandler(deps.setup));
  app.use(
    "/api/setup",
    deps.auth.requireSession(),
    deps.auth.requireAdmin(),
    setupRouter(deps.setup),
  );
  app.use("/api/dashboard/app", deps.auth.requireSession(), appInfoRouter(deps.appInfo));
}

/**
 * Mounts every API route that exists once the server has working credentials. Kept apart from
 * server.ts (which owns config, the YouTube client, the poll loop and the HTTP/WS server) so the
 * route table itself — mount paths included — is what the integration tests exercise, rather than
 * a hand-rolled copy of it that can drift (PRD-05 §2.1).
 *
 * The boot-mode routes are not here — see {@link mountBootRoutes}.
 */
export function mountApiRoutes(app: Express, ctx: AppContext): void {
  // Liveness check — unauthenticated (PRD §5.2 exempts /health). Registered ahead of the guard
  // below so the prefix match on /api/dashboard cannot reach it, and ahead of /api/feedback so
  // it is not swallowed by the Companion router.
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

  // Companion-facing endpoints, behind the grace-mode guard (issue 047). It admits a device
  // token, admits a signed-in browser, and — while grace mode is on — admits a tokenless caller
  // *and records it*, because the module in the field has no token field until issue 048. It is
  // still listed in GUARD_EXEMPTIONS: a tokenless request does get through today, and that stays
  // a stated, reviewable fact until issue 049 flips enforcement.
  const companion = ctx.auth.requireCompanion();
  app.use("/api/action", companion, actionRouter(ctx));
  app.use("/api/feedback", companion, feedbackRouter(ctx));
  // SSE stream — an alternative to polling for any custom integration. The guard is repeated
  // here even though the `/api/feedback` mount above already prefix-matches this path: a route
  // that carries its own guard cannot be left open by someone moving the mount. Matching twice
  // is why the guard records tokenless callers once per request rather than once per run — it
  // was counting a single Companion connection as two.
  app.get("/api/feedback/stream", companion, streamHandler(ctx));

  // Everything browser-facing, behind one guard (issue 044). A prefix guard rather than a guard
  // per mount, so the default for a route added below is "closed": forgetting to repeat the guard
  // is the mistake this slice exists to make impossible, not one to re-open twelve times.
  //
  // The guard is a pass-through on a deployment with no accounts, so a desktop/LAN install cannot
  // be locked out by it — that switch (issue 043) is what makes widening it safe.
  //
  // "Browser-facing" is not the whole truth: the Companion module also calls five routes under
  // this prefix — GET presets / categories / streams, PUT service, POST fill-request. Issue 047
  // closes the gap issue 044 left open here: requireSession() now also admits a device token, so
  // a token-carrying module reaches these five as it reaches its own bases. What it still cannot
  // reach is anything in ADMIN_ONLY — requireAdmin() refuses a device token outright.
  app.use("/api/dashboard", ctx.auth.requireSession());

  app.use("/api/dashboard/presets", presetsRouter(ctx));
  app.use("/api/dashboard/settings", settingsRouter(ctx));
  app.use("/api/dashboard/state", stateRouter(ctx));
  app.use("/api/dashboard/categories", categoriesRouter(ctx));
  app.use("/api/dashboard/streams", streamsRouter(ctx));
  app.use("/api/dashboard/target", targetRouter(ctx));
  app.use("/api/dashboard/broadcasts", broadcastsRouter(ctx));
  app.use("/api/dashboard/ingestion", ingestionRouter(ctx));
  app.use("/api/dashboard/webhook", webhookRouter(ctx));
  app.use("/api/dashboard/service", serviceRouter(ctx));
  app.use("/api/dashboard/logs", logsRouter(ctx));
  // Roles and the people who hold them — admin only, per ADMIN_ONLY above.
  app.use("/api/dashboard/people", ctx.auth.requireAdmin(), peopleRouter({ store: ctx.store, auth: ctx.auth }));
  // Credentials for machines, and the grace-mode readout — admin only, per ADMIN_ONLY above.
  app.use("/api/dashboard/devices", ctx.auth.requireAdmin(), devicesRouter({ store: ctx.store, auth: ctx.auth }));
  // Who did what, and it survived the restart — admin only, per ADMIN_ONLY above.
  app.use("/api/dashboard/audit", ctx.auth.requireAdmin(), auditRouter({ audit: ctx.audit }));
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

/**
 * Serves the built React dashboard, when the build is present. The catch-all is deliberately
 * unguarded: it is what hands a signed-out browser the login page (PRD-15 §6). Its negative
 * lookahead keeps it off `/api/`, so it can never answer for a guarded endpoint.
 */
export function mountWebApp(app: Express, webDist: string): void {
  if (!fs.existsSync(webDist)) return;
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}
