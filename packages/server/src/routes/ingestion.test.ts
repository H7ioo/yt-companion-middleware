import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { youtube_v3 } from "googleapis";
import { ingestionRouter } from "./ingestion.js";
import type { AppContext } from "./context.js";
import type { IngestionReport } from "@app/shared";

function fakeYt(items: youtube_v3.Schema$LiveStream[] | Error) {
  const list = vi.fn(async () => {
    if (items instanceof Error) throw items;
    return { data: { items } };
  });
  return { liveStreams: { list } } as unknown as youtube_v3.Youtube;
}

async function mount(ctx: Partial<AppContext>) {
  const app = express();
  app.use("/api/dashboard/ingestion", ingestionRouter(ctx as AppContext));
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/api/dashboard/ingestion`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const writeCache = () => vi.fn(async (_patch: Record<string, unknown>) => {});

function ctxFor(over: {
  yt: youtube_v3.Youtube;
  streamId?: string | null;
  apiEnabled?: boolean;
  write?: ReturnType<typeof writeCache>;
}): Partial<AppContext> {
  return {
    yt: over.yt,
    store: {
      get: () => ({
        defaults: { defaultStreamBoundId: over.streamId === undefined ? "S1" : over.streamId },
        service: { apiEnabled: over.apiEnabled ?? true },
      }),
    },
    cache: { writeCache: over.write ?? writeCache() },
  } as unknown as Partial<AppContext>;
}

describe("GET /api/dashboard/ingestion", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });

  it("reads the default key live and states what it cost", async () => {
    const m = await mount(
      ctxFor({
        yt: fakeYt([
          {
            id: "S1",
            snippet: { title: "OBS key" },
            status: { streamStatus: "active", healthStatus: { status: "good" } },
          },
        ]),
      }),
    );
    close = m.close;

    const body = (await (await fetch(m.url)).json()) as IngestionReport;
    expect(body.readout?.state).toBe("receiving");
    // The label travels with the reading, so no surface has to classify it a second time.
    expect(body.readout?.label).toBe("Receiving video");
    expect(body.unavailable).toBeNull();
    // One `liveStreams.list` by id — the cheapest question that answers this.
    expect(body.quotaUnits).toBe(1);
  });

  it("caches what it read, so a Companion key sees the same answer without its own call", async () => {
    const write = writeCache();
    const m = await mount(
      ctxFor({
        write,
        yt: fakeYt([{ id: "S1", status: { streamStatus: "active", healthStatus: { status: "bad" } } }]),
      }),
    );
    close = m.close;

    await fetch(m.url);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      ingestion: { streamId: "S1", healthStatus: "bad" },
    });
  });

  it("explains a missing default key instead of erroring", async () => {
    const yt = fakeYt([]);
    const m = await mount(ctxFor({ yt, streamId: null }));
    close = m.close;

    const res = await fetch(m.url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as IngestionReport;
    expect(body.readout).toBeNull();
    expect(body.unavailable).toMatch(/Settings/);
    expect(body.quotaUnits).toBe(0);
    expect((yt.liveStreams.list as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("explains a default key the channel no longer has", async () => {
    const m = await mount(ctxFor({ yt: fakeYt([]) }));
    close = m.close;

    const body = (await (await fetch(m.url)).json()) as IngestionReport;
    expect(body.readout).toBeNull();
    expect(body.unavailable).toMatch(/no longer/i);
    // The call was made, so it is still charged for honestly.
    expect(body.quotaUnits).toBe(1);
  });

  it("refuses while the API master switch is off, spending nothing", async () => {
    const yt = fakeYt([]);
    const m = await mount(ctxFor({ yt, apiEnabled: false }));
    close = m.close;

    const res = await fetch(m.url);
    expect(res.status).toBe(409);
    expect((yt.liveStreams.list as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("maps an API failure to the shared error body rather than leaking a stack", async () => {
    const m = await mount(ctxFor({ yt: fakeYt(Object.assign(new Error("nope"), { code: 401 })) }));
    close = m.close;

    const res = await fetch(m.url);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("YOUTUBE_AUTH_ERROR");
  });
});
