import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { JsonStore } from '../../packages/server/src/storage/jsonStore.js';
import { StateCache } from '../../packages/server/src/core/stateCache.js';
import { ActionRunner } from '../../packages/server/src/core/actionRunner.js';
import { QuotaTracker } from '../../packages/server/src/core/quota.js';
import { StateEvents } from '../../packages/server/src/core/events.js';
import { Logger } from '../../packages/server/src/core/logger.js';
import { FillRequests } from '../../packages/server/src/core/fillRequests.js';
import { mountApiRoutes } from '../../packages/server/src/app.js';
import { attachStateSocket } from '../../packages/server/src/routes/socket.js';
import { Auth } from '../../packages/server/src/auth/actor.js';
import { apiHeaders, joinUrl, wsHandshakeOptions, wsUrl } from './transform.js';

// The credential tracer bullet for issue 048 / PRD-15 §4.
//
// The unit tests above prove the helpers build the right header. This proves the header is the one
// the *real server* accepts, by driving the actual route table and the actual WebSocket upgrade
// with the module's own `apiHeaders()` and `wsHandshakeOptions()` — no hand-written `Bearer`
// string standing in for them. The two halves have been out of step before: v2.0.0 deleted the
// token field on the reasoning that the middleware had no auth, and the day auth landed every
// install in the field was unconfigurable. A test that restates the module's own assumption back
// to itself would not have caught that; only one that asks the server does.

interface Harness {
  url: string;
  auth: any;
  store: any;
  close: () => Promise<void>;
}

const ADMIN = { name: 'operator', password: 'a-long-enough-secret' };

/** Boots the credentialed API surface and the state socket, as server.ts wires them. */
async function boot(): Promise<Harness> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'module-credential-'));
  const store = new JsonStore(path.join(dir, 'store.json'));
  await store.init();
  const auth = new Auth(store);
  await auth.seed(ADMIN);

  const events = new StateEvents();
  const logger = new Logger();
  const quota = new QuotaTracker(store, 10_000, events, logger);
  quota.init();
  // Never started: this test asks who the server lets in, not what YouTube says back.
  const yt = {
    liveBroadcasts: { list: async () => ({ data: { items: [] } }) },
    liveStreams: { list: async () => ({ data: { items: [] } }) },
    videoCategories: { list: async () => ({ data: { items: [] } }) },
  } as any;
  const cache = new StateCache(yt, store, { refreshIntervalMs: 60_000, healthFailureThreshold: 3 }, events, logger);
  const runner = new ActionRunner(yt, store, cache, events, logger);
  const ctx = {
    store,
    runner,
    cache,
    yt,
    quota,
    events,
    logger,
    fills: new FillRequests(events),
    auth,
    regionCode: 'US',
  } as any;

  const app = express();
  app.use(express.json());
  mountApiRoutes(app, ctx);
  const server = http.createServer(app);
  const wss = attachStateSocket(server, ctx);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    auth,
    store,
    close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

let h: Harness;
beforeEach(async () => {
  h = await boot();
});
afterEach(async () => {
  await h.close();
});

/** Mints a device token the way an admin would from the dashboard's Machines section. */
async function mintToken(name = 'companion machine') {
  const admin = h.store.get().accounts.find((a: { role: string }) => a.role === 'admin');
  const created = await h.auth.devices.create({ name, createdBy: admin.id });
  return { token: created.token, id: created.record.id };
}

/**
 * Opens the state socket exactly as `connectWs()` does — same URL helper, same handshake options —
 * and reports "open" or the status the server refused it with.
 */
async function connectAsModule(token: string): Promise<"open" | number> {
  const ws = new WebSocket(wsUrl(h.url), wsHandshakeOptions(token));
  try {
    return await new Promise<"open" | number>((resolve, reject) => {
      ws.once('open', () => resolve('open'));
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.once('error', (err) => {
        const status = /Unexpected server response: (\d+)/.exec(String(err))?.[1];
        if (status) resolve(Number(status));
        else reject(err);
      });
    });
  } finally {
    ws.close();
  }
}

/** GETs a dashboard route exactly as `getJson()` does, with the module's own headers. */
function getAsModule(token: string, route = '/api/dashboard/presets') {
  return fetch(joinUrl(h.url, route), { headers: apiHeaders(token) });
}

describe('the module credential, against the real server', () => {
  it('authenticates an HTTP request with a configured device token', async () => {
    const { token } = await mintToken();
    expect((await getAsModule(token)).status).toBe(200);
  });

  // The five `/api/dashboard/*` routes the module calls were reachable only by a cookie until
  // issue 047 taught `requireSession()` about device callers. Without a token the module cannot
  // populate its dropdowns at all — grace mode covers the Companion bases and the socket, not
  // this prefix — so this is the request that makes the field worth having.
  it('is refused on that same request when the token field is left blank', async () => {
    expect((await getAsModule('')).status).toBe(401);
  });

  it('authenticates the WebSocket handshake with the same token', async () => {
    const { token } = await mintToken();
    expect(await connectAsModule(token)).toBe('open');
  });

  // Both surfaces or neither: the module holds the socket for weeks and posts actions over HTTP,
  // so a credential accepted on one and not the other is a module that half works.
  it('is refused on both surfaces when the token is wrong', async () => {
    expect((await getAsModule('ytm_nonsense')).status).toBe(401);
    expect(await connectAsModule('ytm_nonsense')).toBe(401);
  });

  it('drops the module off both surfaces the moment the token is revoked', async () => {
    const { token, id } = await mintToken();
    expect(await connectAsModule(token)).toBe('open');
    await h.auth.devices.revoke(id);
    expect((await getAsModule(token)).status).toBe(401);
    expect(await connectAsModule(token)).toBe(401);
  });

  // A blank field must look blank on the wire, not like a rejected `Bearer `. Grace mode admits
  // silence and records it; it refuses anything that was presented and failed. Getting this
  // backwards would take every not-yet-configured install offline on the day the module ships,
  // which is the breakage this whole slice exists to prevent.
  it('still connects to the Companion socket with a blank token, and is recorded as tokenless', async () => {
    expect(h.auth.grace.readout().tokenlessCount).toBe(0);
    const ws = new WebSocket(wsUrl(h.url), wsHandshakeOptions(''));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.close();
    expect(h.auth.grace.readout().tokenlessCount).toBe(1);
  });

  it('is admitted by the Companion socket once the token is pasted in, with nothing recorded', async () => {
    const { token } = await mintToken();
    expect(await connectAsModule(token)).toBe('open');
    expect(h.auth.grace.readout().tokenlessCount).toBe(0);
  });
});
