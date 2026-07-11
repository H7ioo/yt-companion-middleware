import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import type { youtube_v3 } from "googleapis";
import { JsonStore } from "../storage/jsonStore.js";
import { StateCache } from "./stateCache.js";
import { Logger } from "./logger.js";

/** A YouTube client whose broadcast list rejects with `err`, to drive the failure path. */
function failingClient(err: unknown): youtube_v3.Youtube {
  return {
    liveBroadcasts: { list: () => Promise.reject(err) },
  } as unknown as youtube_v3.Youtube;
}

describe("StateCache activity logging (issue 018 / PRD-06 §3)", () => {
  let store: JsonStore;
  let dir: string;
  let logger: Logger;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cache-log-"));
    store = new JsonStore(path.join(dir, "store.json"));
    await store.init();
    logger = new Logger();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("logs a network-classified failure so it appears in the panel", async () => {
    const cache = new StateCache(
      failingClient({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" }),
      store,
      { refreshIntervalMs: 60_000, healthFailureThreshold: 3 },
      undefined,
      logger,
    );
    await cache.refresh();

    const [entry] = logger.list();
    expect(entry.category).toBe("network");
    expect(entry.level).toBe("error");
    expect(entry.code).toBe("NETWORK_ERROR");
  });

  it("logs a recovery once the connection comes back healthy", async () => {
    // A client that fails first, then returns an idle (no-target) channel — a healthy state.
    let down = true;
    const flakyClient = {
      liveBroadcasts: {
        list: () =>
          down
            ? Promise.reject({ code: "ECONNREFUSED", message: "down" })
            : Promise.resolve({ data: { items: [] } }),
      },
    } as unknown as youtube_v3.Youtube;

    const cache = new StateCache(
      flakyClient,
      store,
      { refreshIntervalMs: 60_000, healthFailureThreshold: 3 },
      undefined,
      logger,
    );
    await cache.refresh(); // fails -> degraded, logs a network error
    logger.clear();
    down = false;
    await cache.refresh(); // recovers -> ok

    const [entry] = logger.list();
    expect(entry.category).toBe("system");
    expect(entry.level).toBe("info");
    expect(entry.message).toMatch(/recover/i);
  });

  it("does not log a recovery when refresh was already healthy", async () => {
    const cache = new StateCache(
      { liveBroadcasts: { list: () => Promise.resolve({ data: { items: [] } }) } } as unknown as youtube_v3.Youtube,
      store,
      { refreshIntervalMs: 60_000, healthFailureThreshold: 3 },
      undefined,
      logger,
    );
    await cache.refresh();
    expect(logger.list()).toHaveLength(0);
  });
});
