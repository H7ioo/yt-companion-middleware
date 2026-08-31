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
import { webhookRouter } from "./routes/webhook.js";
import { serviceRouter } from "./routes/service.js";
import { logsRouter } from "./routes/logs.js";
import { streamHandler } from "./routes/stream.js";
import { fillRequestRouter, notifyRouter } from "./routes/fillRequest.js";
import { setupRouter, setupStatusHandler, type SetupDeps } from "./routes/setup.js";
import { appInfoRouter, type AppInfoDeps } from "./routes/appInfo.js";
import { authRouter } from "./routes/auth.js";
import { peopleRouter } from "./routes/people.js";
import type { Auth } from "./auth/actor.js";

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
      "Companion-facing. The module carries no token today, so guarding it is the go-dark " +
      "outage described in PRD-15 §4 — handled by issues 047 → 048 → 049. Note this leaves the " +
      "module only half-open: it also calls five /api/dashboard/* routes, which the guard below " +
      "does close on a seeded deployment (see the comment there).",
  },
  {
    mount: "/api/feedback",
    why: "Companion-facing, same as /api/action.",
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
];

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

  // Companion-facing endpoints — deliberately still open (see GUARD_EXEMPTIONS).
  app.use("/api/action", actionRouter(ctx));
  app.use("/api/feedback", feedbackRouter(ctx));
  // SSE stream — an alternative to polling for any custom integration.
  app.get("/api/feedback/stream", streamHandler(ctx));

  // Everything browser-facing, behind one guard (issue 044). A prefix guard rather than a guard
  // per mount, so the default for a route added below is "closed": forgetting to repeat the guard
  // is the mistake this slice exists to make impossible, not one to re-open twelve times.
  //
  // The guard is a pass-through on a deployment with no accounts, so a desktop/LAN install cannot
  // be locked out by it — that switch (issue 043) is what makes widening it safe.
  //
  // "Browser-facing" is not the whole truth: the Companion module also calls five routes under
  // this prefix — GET presets / categories / streams, PUT service, POST fill-request — and on a
  // seeded deployment they are now closed to it. No install is affected today (no hosted one
  // exists, and authentication is dormant without a seeded admin), but the token work in issues
  // 047 → 049 has to cover these five as well as the Companion bases, or a token-carrying module
  // still goes dark. See the note in issues/done/044-guard-dashboard-routes-and-exemptions.md.
  app.use("/api/dashboard", ctx.auth.requireSession());

  app.use("/api/dashboard/presets", presetsRouter(ctx));
  app.use("/api/dashboard/settings", settingsRouter(ctx));
  app.use("/api/dashboard/state", stateRouter(ctx));
  app.use("/api/dashboard/categories", categoriesRouter(ctx));
  app.use("/api/dashboard/streams", streamsRouter(ctx));
  app.use("/api/dashboard/target", targetRouter(ctx));
  app.use("/api/dashboard/webhook", webhookRouter(ctx));
  app.use("/api/dashboard/service", serviceRouter(ctx));
  app.use("/api/dashboard/logs", logsRouter(ctx));
  // Roles and the people who hold them — admin only, per ADMIN_ONLY above.
  app.use("/api/dashboard/people", ctx.auth.requireAdmin(), peopleRouter({ store: ctx.store, auth: ctx.auth }));
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
