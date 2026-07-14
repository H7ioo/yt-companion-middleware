import { randomUUID } from "node:crypto";
import type { FillRequest } from "@app/shared";
import type { StateEvents } from "./events.js";

/** Unclaimed requests older than this never pop — a key pressed with no dashboard open must not
 *  surprise the operator an hour later. */
const TTL_MS = 60_000;

/**
 * The single pending "fill this preset" slot behind POST /api/dashboard/fill-request (the
 * Companion key press) and its claim endpoint (the dashboard). One slot, not a queue: a second
 * key press replaces the first — the operator's latest intent wins. In-memory only; a restart
 * drops at most one 60s-old request.
 */
export class FillRequests {
  private slot: FillRequest | null = null;
  private expiresAt = 0;

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
    this.events.emitChange();
    return this.slot;
  }

  /** The live pending request, if any. Expiry is lazy — checked on read, not on a timer. */
  pending(): FillRequest | null {
    if (this.slot && this.now() >= this.expiresAt) this.slot = null;
    return this.slot;
  }

  /**
   * Atomically takes the pending request by id. Exactly one caller wins when several dashboards
   * race the same push; losers get false and stay quiet.
   */
  claim(id: string): boolean {
    if (this.pending()?.id !== id) return false;
    this.slot = null;
    this.events.emitChange();
    return true;
  }
}
