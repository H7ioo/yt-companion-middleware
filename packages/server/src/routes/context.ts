import type { youtube_v3 } from "googleapis";
import type { JsonStore } from "../storage/jsonStore.js";
import type { ActionRunner } from "../core/actionRunner.js";
import type { StateCache } from "../core/stateCache.js";
import type { QuotaTracker } from "../core/quota.js";
import type { StateEvents } from "../core/events.js";
import type { Logger } from "../core/logger.js";
import type { FillRequests } from "../core/fillRequests.js";
import type { Auth } from "../auth/actor.js";

/** Shared dependencies handed to route factories. */
export interface AppContext {
  store: JsonStore;
  runner: ActionRunner;
  cache: StateCache;
  yt: youtube_v3.Youtube;
  quota: QuotaTracker;
  events: StateEvents;
  logger: Logger;
  fills: FillRequests;
  /** "Who is asking?" — the identity seam (issue 043); dormant when nothing is seeded. */
  auth: Auth;
  regionCode: string;
}
