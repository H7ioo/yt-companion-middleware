import type { Request, Response } from "express";
import type { AppContext } from "./context.js";
import { buildDashboardState, changeSignature } from "../core/snapshot.js";

const HEARTBEAT_MS = 25000;

/**
 * Server-Sent Events stream of state changes (PRD feature: push instead of poll). Emits an
 * initial `state` event on connect, then one on every meaningful change — so the dashboard
 * (and any custom integration) reacts instantly instead of polling every 5s. A comment
 * heartbeat keeps intermediary proxies from closing the idle connection.
 */
export function streamHandler(ctx: AppContext) {
  return (req: Request, res: Response): void => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Disable proxy buffering (nginx) so events flush immediately.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    let lastSignature: string | null = null;
    const send = (): void => {
      const state = buildDashboardState(ctx.cache, ctx.runner, ctx.quota);
      const signature = changeSignature(state);
      if (signature === lastSignature) return;
      lastSignature = signature;
      res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    };

    send();
    const unsubscribe = ctx.events.onChange(send);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  };
}
