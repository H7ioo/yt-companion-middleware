import type { JsonStore } from "../storage/jsonStore.js";
import type { StateEvents } from "./events.js";
import type { StateCache } from "./stateCache.js";
import type { ActionRunner } from "./actionRunner.js";
import type { QuotaTracker } from "./quota.js";
import type { FillRequests } from "./fillRequests.js";
import { buildDashboardState, changeSignature, type DashboardState } from "./snapshot.js";

const TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 2;

/**
 * Pushes state changes to an operator-configured URL so Companion (or anything else) can
 * react without polling. Subscribes to the change signal, rebuilds the snapshot, dedupes
 * with `changeSignature`, and POSTs it. Delivery is best-effort: failures are logged and
 * never affect the action pipeline. Deliveries are serialized so events arrive in order.
 */
export class WebhookDispatcher {
  private lastSignature: string | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly store: JsonStore,
    private readonly cache: StateCache,
    private readonly runner: ActionRunner,
    private readonly quota: QuotaTracker,
    private readonly events: StateEvents,
    private readonly fills: FillRequests,
  ) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.events.onChange(() => this.onChange());
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onChange(): void {
    const url = this.store.get().webhook.url;
    if (!url) return;
    const state = buildDashboardState(this.store, this.cache, this.runner, this.quota, this.fills);
    const signature = changeSignature(state);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    // Serialize so out-of-order POSTs can't race.
    this.chain = this.chain.then(() => this.deliver(url, state)).catch(() => undefined);
  }

  private async deliver(url: string, state: DashboardState): Promise<void> {
    const payload = JSON.stringify({ event: "state", state });
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: controller.signal,
        });
        if (res.ok) return;
        console.warn(`[webhook] ${url} responded ${res.status} (attempt ${attempt})`);
      } catch (err) {
        console.warn(`[webhook] delivery to ${url} failed (attempt ${attempt}): ${String(err)}`);
      } finally {
        clearTimeout(timer);
      }
    }
  }
}
