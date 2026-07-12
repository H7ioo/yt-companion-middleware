import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mountDocsRoutes } from "./docs.js";

/**
 * The doc sites are static files, so what can break is the wiring: a mount that stops serving the
 * split pages, or a `/guide` that 404s because it no longer resolves to an index. Both are silent
 * in a unit test and loud in front of an operator, so they get a real HTTP round trip.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../../public");

let server: http.Server;
let base: string;

beforeEach(async () => {
  const app = express();
  mountDocsRoutes(app, publicDir);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("no port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("mountDocsRoutes", () => {
  it("serves the guide index at /guide, the bookmark everyone already has", async () => {
    const res = await fetch(`${base}/guide`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Operator Manual");
  });

  it("serves the console index at /docs", async () => {
    const res = await fetch(`${base}/docs`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("YouTube Live Middleware API");
  });

  it("serves every topic page and its shared assets", async () => {
    const paths = [
      "/guide/setup.html",
      "/guide/api.html",
      "/guide/companion.html",
      "/guide/fill-flow.html",
      "/guide/assets/guide.css",
      "/guide/assets/nav.js",
      "/docs/action.html",
      "/docs/feedback.html",
      "/docs/assets/console.css",
      "/docs/assets/buses.js",
      "/docs/assets/console.js",
    ];
    for (const p of paths) {
      const res = await fetch(base + p);
      expect([p, res.status]).toEqual([p, 200]);
    }
  });

  it("404s an unknown doc page rather than serving an index for it", async () => {
    expect((await fetch(`${base}/guide/nope.html`)).status).toBe(404);
  });
});
