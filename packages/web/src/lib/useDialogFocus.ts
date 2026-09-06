import { useEffect, type RefObject } from "react";

/** Everything inside a dialog Tab can land on, in document order. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The keyboard half of a modal dialog: Escape closes it, Tab stays inside it, focus opens into
 * it and returns where it came from.
 *
 * Shared rather than written twice (issue 070), because a dialog that says `aria-modal="true"`
 * and then lets Tab wander behind it is lying to a screen reader — and the second implementation
 * is always the one missing a piece. The delete confirmation had this; the edit modal, the
 * larger of the two and the one holding unsaved work, did not.
 *
 * Escape is handled in the capture phase for the same reason the delete dialog does it: the key
 * belongs to *this* question, not to whatever panel it is sitting inside. A control that opens
 * something within the dialog — the date field's calendar — consumes its own Escape first, in
 * capture, and never reaches here.
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Something inside the dialog is expanded — the date field's calendar, a menu — so the
        // key belongs to it, and this handler leaves the event alone entirely. Asked of the DOM
        // rather than settled by which listener registered first: both listen on `document` in
        // capture, and React re-registers an inline handler on every render, so registration
        // order is not something either side can rely on.
        if (ref.current?.querySelector('[aria-expanded="true"]')) return;
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = ref.current;
      if (!dialog) return;
      const stops = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !(el as HTMLButtonElement).disabled,
      );
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const focused = document.activeElement;
      if (e.shiftKey && (focused === first || !dialog.contains(focused))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (focused === last || !dialog.contains(focused))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [ref, onClose, active]);

  useEffect(() => {
    if (!active) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => restoreTo?.focus?.();
  }, [ref, active]);
}
