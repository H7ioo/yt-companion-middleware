import { randomUUID } from "node:crypto";
import type { FillRequest } from "@app/shared";
import type { StateEvents } from "./events.js";

/** Unclaimed requests older than this never pop — a key pressed with no dashboard open must not
 *  surprise the operator an hour later. */
const TTL_MS = 60_000;

/**
 * The single pending "fill this preset" slot behind POST /api/dashboard/fill-request (the
 * Companion key press). One slot, not a queue: a second key press replaces the first — the
 * operator's latest intent wins. In-memory only; a restart drops at most one 60s-old request.
 *
 * The request is *broadcast*, not claimed: every open dashboard sees it on the state push and pops
 * its own fill popup. There is deliberately no exclusive claim — the operator may be watching any
 * one of several open surfaces (the desktop window on the stream PC plus a phone over Tailscale),
 * and an exclusive claim would land the popup on whichever surface was fastest, not the one they're
 * looking at. The slot simply expires after the TTL; nothing consumes it.
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

  /** The live pending request, if any. Expiry is lazy — checked on read, not on a timer. A read
   *  never consumes the request: every dashboard reads the same pending slot and pops the popup. */
  pending(): FillRequest | null {
    if (this.slot && this.now() >= this.expiresAt) this.slot = null;
    return this.slot;
  }
}
