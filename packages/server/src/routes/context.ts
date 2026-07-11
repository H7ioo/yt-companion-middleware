import type { youtube_v3 } from "googleapis";
import type { JsonStore } from "../storage/jsonStore.js";
import type { ActionRunner } from "../core/actionRunner.js";
import type { StateCache } from "../core/stateCache.js";
import type { QuotaTracker } from "../core/quota.js";
import type { StateEvents } from "../core/events.js";
import type { Logger } from "../core/logger.js";

/** Shared dependencies handed to route factories. */
export interface AppContext {
  store: JsonStore;
  runner: ActionRunner;
  cache: StateCache;
  yt: youtube_v3.Youtube;
  quota: QuotaTracker;
  events: StateEvents;
  logger: Logger;
  regionCode: string;
}
