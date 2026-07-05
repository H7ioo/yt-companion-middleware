import type { NextFunction, Request, Response } from "express";
import type { JsonStore } from "../storage/jsonStore.js";
import { verifyToken } from "./apiToken.js";

/**
 * Protects Companion-facing endpoints with a Bearer token (PRD §5.2). LAN-trust threat
 * model: the goal is to stop an unrelated device on the network from casually hitting
 * the endpoint, not to defeat a determined attacker.
 *
 * If no token has been configured yet, requests are allowed through so the operator can
 * reach the dashboard to generate one on first run.
 */
export function bearerAuth(store: JsonStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const record = store.get().token;
    if (!record.hash) {
      next();
      return;
    }

    const header = req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const presented = match?.[1];

    if (presented && verifyToken(store, presented)) {
      next();
      return;
    }

    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Missing or invalid Bearer token" },
    });
  };
}
