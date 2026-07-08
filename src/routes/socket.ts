import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import type { AppContext } from "./context.js";
import { buildDashboardState, changeSignature } from "../core/snapshot.js";

const HEARTBEAT_MS = 25000;

// Both aliases upgrade to the same push stream, matching the dual /api/action and
// /api/dashboard/action mounting so Companion buttons on either path keep working.
const WS_PATHS = new Set(["/api/feedback/ws", "/api/dashboard/ws"]);

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
    if (!WS_PATHS.has(pathname)) {
      // No other upgrade handler on this server — close unknown upgrades rather than leak them.
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    let lastSignature: string | null = null;
    // `force` re-delivers the current state even when unchanged — used for resync (inbound
    // request or periodic heartbeat) so a button added after connect isn't stuck blank
    // waiting for the next real change.
    const send = (force = false): void => {
      if (ws.readyState !== ws.OPEN) return;
      const state = buildDashboardState(ctx.store, ctx.cache, ctx.runner, ctx.quota);
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
