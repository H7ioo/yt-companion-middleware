import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../../packages/server/src/storage/jsonStore.js';
import { StateCache } from '../../packages/server/src/core/stateCache.js';
import { ActionRunner } from '../../packages/server/src/core/actionRunner.js';
import { QuotaTracker } from '../../packages/server/src/core/quota.js';
import { StateEvents } from '../../packages/server/src/core/events.js';
import { Logger } from '../../packages/server/src/core/logger.js';
import { FillRequests } from '../../packages/server/src/core/fillRequests.js';
import { buildDashboardState } from '../../packages/server/src/core/snapshot.js';
import { mountApiRoutes } from '../../packages/server/src/app.js';
import { Auth } from '../../packages/server/src/auth/actor.js';
import { apiHeaders, formatLastError, joinUrl, prepareBody } from './transform.js';

/**
 * The tracer bullet for issue 063: a key press, the real prepare route, and the readout that comes
 * back to the deck — end to end.
 *
 * The unit tests above pin what `prepareBody()` builds. This asks the question they cannot: does
 * the *server* accept it, and does the state the module reads its feedback from then say the
 * broadcast is prepared? Those two halves have drifted before — the module is bundled standalone
 * and cannot import the server's contract — and a test that only restated the module's own
 * assumptions would not notice.
 *
 * The three states the feedback distinguishes are each driven from a real outcome rather than a
 * hand-built record: bound (insert + bind both land), unbound (the bind is refused after the
 * insert), and nothing prepared (no press at all).
 */
interface FakeYouTube {
  bindError?: unknown;
  insertError?: unknown;
}

interface Harness {
  url: string;
  token: string;
  fake: FakeYouTube;
  store: any;
  state: () => any;
  close: () => Promise<void>;
}

const ADMIN = { name: 'operator', password: 'a-long-enough-secret' };

async function boot(): Promise<Harness> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'module-prepare-'));
  const store = new JsonStore(path.join(dir, 'store.json'));
  await store.init();
  const auth = new Auth(store);
  await auth.seed(ADMIN);

  const fake: FakeYouTube = {};
  const yt = {
    liveBroadcasts: {
      list: async () => ({ data: { items: [] } }),
      insert: async (params: any) => {
        if (fake.insertError) throw fake.insertError;
        return { data: { id: 'new-1', ...(params.requestBody ?? {}) } };
      },
      bind: async (params: any) => {
        if (fake.bindError) throw fake.bindError;
        return { data: { id: params.id } };
      },
    },
    liveStreams: {
      list: async () => ({ data: { items: [] } }),
      insert: async () => {
        throw new Error('preparing must never create a stream — OBS already holds the key');
      },
    },
    videoCategories: { list: async () => ({ data: { items: [] } }) },
  } as any;

  const events = new StateEvents();
  const logger = new Logger();
  const quota = new QuotaTracker(store, 10_000, events, logger);
  quota.init();
  const cache = new StateCache(yt, store, { refreshIntervalMs: 60_000, healthFailureThreshold: 3 }, events, logger);
  const runner = new ActionRunner(yt, store, cache, events, logger);
  const fills = new FillRequests(events);
  const ctx = { store, runner, cache, yt, quota, events, logger, fills, auth, regionCode: 'US' } as any;

  const app = express();
  app.use(express.json());
  mountApiRoutes(app, ctx);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const { port } = server.address() as { port: number };

  const admin = store.get().accounts.find((a: { role: string }) => a.role === 'admin');
  const device = await auth.devices.create({ name: 'companion machine', createdBy: admin.id });

  return {
    url: `http://127.0.0.1:${port}`,
    token: device.token,
    fake,
    store,
    // The very frame the module's WebSocket receives, built by the server's own assembler — so the
    // feedback below is reading exactly what a key would read.
    state: () => buildDashboardState(store, cache, runner, quota, fills),
    close: async () => {
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

/** The press: the module's own body builder, its own headers, the server's real route. */
async function pressPrepare(options: Record<string, unknown>, nowMs = Date.now()) {
  const { body, error } = prepareBody(options, nowMs);
  if (error) return { status: 0, json: { error: { code: 'INVALID_REQUEST', message: error } } as any };
  const res = await fetch(joinUrl(h.url, '/api/dashboard/broadcasts/prepare'), {
    method: 'POST',
    headers: apiHeaders(h.token),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

/** What the `prepared_state` feedback would see, off the frame the server pushes. */
const feedbackState = () => h.state().prepared.state;

describe('preparing from a key (issue 063)', () => {
  it('says nothing is prepared until something is', () => {
    expect(feedbackState()).toBe('none');
  });

  it('creates the broadcast the button asked for and reports it as prepared and bound', async () => {
    const { status, json } = await pressPrepare({ title: 'Friday night', streamId: 'stream-9', start: '+2h' });
    expect(status).toBe(200);
    expect(json.prepared.title).toBe('Friday night');
    // The share link — the whole reason preparing early is worth doing — is on the key immediately.
    expect(json.prepared.watchUrl).toBe('https://www.youtube.com/watch?v=new-1');
    expect(h.state().prepared.watchUrl).toBe(json.prepared.watchUrl);
    expect(feedbackState()).toBe('prepared');
  });

  // The half-finished preparation: the broadcast is on the channel with a working link, and
  // nothing the encoder pushes will ever arrive on it. A key that showed this as ready is the
  // failure this feedback exists to prevent.
  it('reports a broadcast whose bind was refused as prepared but not bound', async () => {
    h.fake.bindError = new Error('bind refused');
    const { status, json } = await pressPrepare({ title: 'Friday night', streamId: 'stream-9', start: '+2h' });
    expect(status).toBe(200);
    expect(json.warning).toMatch(/could not be bound/i);
    expect(feedbackState()).toBe('unbound');
  });

  // Riding mode (issue 061): YouTube refusing the channel, not the app refusing the operator. The
  // refusal has to reach `last_error` in YouTube's own words — a press that quietly did nothing is
  // the outcome this rules out.
  it('surfaces a refused insert as an error a key can show', async () => {
    // The shape googleapis actually throws, because the classifier reads the status and the reason
    // off the response — a hand-rolled error would pass this test and fail in the field.
    h.fake.insertError = Object.assign(new Error('The user is not enabled for live streaming.'), {
      response: {
        status: 403,
        data: {
          error: {
            errors: [{ reason: 'liveStreamingNotEnabled' }],
            message: 'The user is not enabled for live streaming.',
          },
        },
      },
    });
    const { status, json } = await pressPrepare({ title: 'Friday night', streamId: 'stream-9', start: '+2h' });
    expect(status).toBe(409);
    const lastError = formatLastError(json.error);
    expect(lastError).toMatch(/live streaming/i);
    expect(lastError).not.toBe('unknown error');
    // Nothing was created, so the deck must not claim anything is waiting.
    expect(feedbackState()).toBe('none');
  });

  // Refused in the module, before the request: creating a broadcast is a write that puts a public
  // link into the world, so a press that could not have worked never becomes one.
  it('never reaches the server when the button has neither a preset nor a title', async () => {
    const { status } = await pressPrepare({ presetId: '', title: '', start: 'now' });
    expect(status).toBe(0);
    expect(h.store.get().preparedBroadcasts).toEqual([]);
  });
});
