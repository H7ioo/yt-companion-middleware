import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import type { AppContext } from "./context.js";
import { buildDashboardState, changeSignature } from "../core/snapshot.js";

const HEARTBEAT_MS = 25000;

/**
 * The upgrade table, and who may reach each entry (issue 044).
 *
 * A WebSocket never runs express middleware: the upgrade is served straight off the HTTP server,
 * so the `/api/dashboard` prefix guard in app.ts cannot see it. The guard is therefore repeated
 * here, from this table — and the audit in `guard.integration.test.ts` walks it, so a socket added
 * without a stated answer fails CI rather than shipping open.
 *
 * Both bases upgrade to the same push stream, matching the by-caller /api/action (Companion) and
 * /api/dashboard/action (dashboard) mounting — both intentional.
 */
export const WS_ROUTES: ReadonlyArray<{ path: string; guarded: boolean; why: string }> = [
  {
    path: "/api/feedback/ws",
    guarded: false,
    why:
      "Companion-facing, exactly as /api/feedback is. The module carries no token today, so " +
      "guarding it is the go-dark outage in PRD-15 §4 — handled by issues 047 → 048 → 049.",
  },
  {
    path: "/api/dashboard/ws",
    guarded: true,
    why: "Browser-facing: it streams the full dashboard state, so it answers to a session only.",
  },
];

const WS_PATHS = new Map(WS_ROUTES.map((r) => [r.path, r]));

/**
 * WebSocket push of state changes — Bitfocus Companion's WebSocket module prefers this over
 * SSE. Mirrors the SSE stream exactly: a `state` frame on connect, then one per meaningful
 * change (deduped by changeSignature). SSE (/api/feedback/stream) and 5s polling stay
 * available; this is an additional transport, not a replacement.
 *
 * Frame shape: `{ "event": "state", "state": {…} }` — same envelope the change webhook uses.
 */
export function attachStateSocket(server: Server, ctx: AppContext): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const route = WS_PATHS.get(pathname);
    if (!route) {
      // No other upgrade handler on this server — close unknown upgrades rather than leak them.
      socket.destroy();
      return;
    }
    void (async () => {
      // The express guard cannot run here, so the same question is asked directly. It is a
      // pass-through on a deployment with no accounts, exactly as `requireSession()` is.
      if (route.guarded && ctx.auth.required && !(await ctx.auth.actorOfCookies(req.headers.cookie))) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    })().catch(() => socket.destroy());
  });

  wss.on("connection", (ws: WebSocket) => {
    let lastSignature: string | null = null;
    // `force` re-delivers the current state even when unchanged — used for resync (inbound
    // request or periodic heartbeat) so a button added after connect isn't stuck blank
    // waiting for the next real change.
    const send = (force = false): void => {
      if (ws.readyState !== ws.OPEN) return;
      const state = buildDashboardState(ctx.store, ctx.cache, ctx.runner, ctx.quota, ctx.fills);
      const signature = changeSignature(state);
      if (!force && signature === lastSignature) return;
      lastSignature = signature;
      ws.send(JSON.stringify({ event: "state", state }));
    };

    send();
    // onChange passes no args, so real changes stay deduped by signature.
    const unsubscribe = ctx.events.onChange(send);
    // Any inbound frame is a resync request (Companion "send message" action, generic text or
    // hex — content is ignored): a button configured after connect can pull current state on
    // demand instead of waiting for a state change to reach it.
    ws.on("message", () => send(true));
    // Ping keeps intermediaries from dropping an idle socket; the client pongs automatically.
    // The forced resend on the same cadence re-delivers full state so a newly configured
    // button converges within one interval even with no state change and no manual pull.
    const heartbeat = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      ws.ping();
      send(true);
    }, HEARTBEAT_MS);

    const teardown = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    ws.on("close", teardown);
    ws.on("error", teardown);
  });

  return wss;
}
