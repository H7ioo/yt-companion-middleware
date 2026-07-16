import { randomUUID } from "node:crypto";
import type { FillRequest } from "@app/shared";
import type { StateEvents } from "./events.js";

/** Unclaimed requests older than this never pop — a key pressed with no dashboard open must not
 *  surprise the operator an hour later. Dashboards also close a still-open popup at expiry, so
 *  the window has to be short enough that a stale request never outlives its moment. */
const TTL_MS = 30_000;

/**
 * The single pending "fill this preset" slot behind POST /api/dashboard/fill-request (the
 * Companion key press). One slot, not a queue: a second key press replaces the first — the
 * operator's latest intent wins. In-memory only; a restart drops at most one 30s-old request.
 *
 * The request is *broadcast*, not claimed: every open dashboard sees it on the state push and pops
 * its own fill popup. There is deliberately no exclusive claim — the operator may be watching any
 * one of several open surfaces (the desktop window on the stream PC plus a phone over Tailscale),
 * and an exclusive claim would land the popup on whichever surface was fastest, not the one they're
 * looking at. Expiry is signalled, not just lazy: dashboards need the state push at TTL to close a
 * popup nobody answered.
 */
export class FillRequests {
  private slot: FillRequest | null = null;
  private expiresAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly events: StateEvents,
    private readonly now: () => number = Date.now,
  ) {}

  /** Raises a new request (replacing any pending one) and signals state subscribers. */
  request(presetId: string): FillRequest {
    this.slot = {
      id: randomUUID(),
      presetId,
      requestedAt: new Date(this.now()).toISOString(),
    };
    this.expiresAt = this.now() + TTL_MS;
    // Signal expiry when it happens — a popup already on screen closes on this push, which the
    // lazy read-side check alone can never trigger. unref: an idle timer must not hold the
    // process open through shutdown.
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.expire(), TTL_MS);
    this.timer.unref?.();
    this.events.emitChange();
    return this.slot;
  }

  /** The live pending request, if any. Expiry is also checked on read so a stale slot never leaks
   *  to a dashboard even if the timer hasn't fired (fake clocks, clock jumps). A read never
   *  consumes the request: every dashboard reads the same pending slot and pops the popup. */
  pending(): FillRequest | null {
    if (this.slot && this.now() >= this.expiresAt) this.slot = null;
    return this.slot;
  }

  private expire(): void {
    this.timer = null;
    if (!this.slot) return;
    this.slot = null;
    this.events.emitChange();
  }
}
