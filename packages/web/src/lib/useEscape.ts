import { useEffect } from "react";

interface Options {
  /**
   * Listen in the capture phase and stop the event once this handler has used it.
   *
   * For a control that opens something *inside* an overlay — the date field's calendar inside
   * the edit modal (issue 070). Both listen on `document`, and without this the one Escape
   * closes the calendar *and* the modal behind it, throwing away every edit the operator had
   * made. Capture at `document` runs before the bubble-phase listeners on the same element, and
   * stopping there keeps them from running at all — the same reason the delete dialog traps the
   * keyboard in capture.
   *
   * The inner handler is the one that sets this, because only it knows whether it has anything
   * open to close: an Escape it does not consume must still reach the overlay.
   */
  capture?: boolean;
}

/**
 * Closes an overlay when Escape is pressed. Mirrors the click-outside affordance the modals
 * already have, so a popup can be dismissed from the keyboard without reaching for the mouse.
 *
 * The handler returns whether it actually consumed the key. Under `capture`, a consumed Escape
 * goes no further; an unconsumed one carries on to whatever is behind.
 */
export function useEscape(onEscape: () => boolean | void, opts: Options = {}): void {
  const { capture = false } = opts;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const consumed = onEscape();
      if (capture && consumed) e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, capture);
    return () => document.removeEventListener("keydown", onKey, capture);
  }, [onEscape, capture]);
}
