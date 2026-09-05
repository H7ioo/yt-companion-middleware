import { useEffect, useRef, useState } from "react";

/** How long "Copied" stands before the button offers the copy again. */
export const COPIED_MS = 2500;

/**
 * The "Copied" acknowledgement on a copy-link button, and — the part that is easy to forget —
 * its expiry.
 *
 * A label that says "Copied" until the panel unmounts stops being feedback and becomes a claim
 * about the clipboard that goes stale the moment anything else is copied. Worse, the button no
 * longer reads as pressable, so the second copy of the same link looks unavailable. So the
 * acknowledgement is a flash: it says what happened, then hands the button back.
 */
export function useCopied(): [string | null, (url: string | null) => void] {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleared on unmount so a panel closed inside the window does not set state on a dead
  // component, and re-armed on every copy so copying a second link restarts the clock.
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const mark = (url: string | null) => {
    if (timer.current !== null) clearTimeout(timer.current);
    setCopiedUrl(url);
    if (url === null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setCopiedUrl(null);
    }, COPIED_MS);
  };

  return [copiedUrl, mark];
}
