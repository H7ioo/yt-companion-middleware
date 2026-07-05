import { EventEmitter } from "node:events";

/**
 * A lightweight "state may have changed" signal. Producers (the state cache, action runner,
 * quota tracker) emit liberally; consumers (SSE clients, the webhook dispatcher) rebuild the
 * full snapshot and dedupe with `changeSignature`, so a spurious tick costs nothing.
 */
export class StateEvents extends EventEmitter {
  constructor() {
    super();
    // Many SSE clients plus the webhook dispatcher can subscribe; lift the default cap.
    this.setMaxListeners(100);
  }

  emitChange(): void {
    this.emit("change");
  }

  /** Subscribe; returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.on("change", listener);
    return () => {
      this.off("change", listener);
    };
  }
}
