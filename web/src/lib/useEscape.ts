import { useEffect } from "react";

/**
 * Closes an overlay when Escape is pressed. Mirrors the click-outside affordance the modals
 * already have, so a popup can be dismissed from the keyboard without reaching for the mouse.
 */
export function useEscape(onEscape: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onEscape]);
}
