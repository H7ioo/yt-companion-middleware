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
    const send = (): void => {
      if (ws.readyState !== ws.OPEN) return;
      const state = buildDashboardState(ctx.store, ctx.cache, ctx.runner, ctx.quota);
      const signature = changeSignature(state);
      if (signature === lastSignature) return;
      lastSignature = signature;
      ws.send(JSON.stringify({ event: "state", state }));
    };

    send();
    const unsubscribe = ctx.events.onChange(send);
    // Ping keeps intermediaries from dropping an idle socket; the client pongs automatically.
    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
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
