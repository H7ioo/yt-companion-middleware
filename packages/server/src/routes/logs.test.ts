import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import { Logger } from "../core/logger.js";
import { logsRouter } from "./logs.js";
import type { AppContext } from "./context.js";

async function mount(logger: Logger) {
  const app = express();
  app.use(express.json());
  app.use("/api/dashboard/logs", logsRouter({ logger } as unknown as AppContext));
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("GET /api/dashboard/logs", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });

  it("returns the buffered events newest-first", async () => {
    const logger = new Logger();
    logger.push({ level: "info", category: "system", code: null, message: "older" });
    logger.push({ level: "warn", category: "quota", code: "YOUTUBE_QUOTA_LOW", message: "newer" });
    const m = await mount(logger);
    close = m.close;

    const res = await fetch(`${m.url}/api/dashboard/logs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ message: string; category: string }>;
    expect(body.map((e) => e.message)).toEqual(["newer", "older"]);
    expect(body[0].category).toBe("quota");
  });
});
