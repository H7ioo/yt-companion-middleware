/**
 * The hosted connect flow's return trip (issue 052).
 *
 * The admin leaves this page entirely — to `accounts.google.com` and back through the server's
 * callback — so nothing in React state survives. The outcome arrives as a query string on a fresh
 * page load and this reads it out. Pure and location-agnostic so it can be tested without a DOM;
 * {@link clearConnectReturn} does the one impure part.
 */
export type ConnectReturn = { ok: true } | { ok: false; message: string };

/** The wording used when the server sent a failure with nothing legible in it. */
const GENERIC = "The YouTube sign-in did not complete.";

export function readConnectReturn(url: URL): ConnectReturn | null {
  const params = url.searchParams;
  if (params.get("connected") === "youtube") return { ok: true };
  if (params.has("connect_error")) {
    return { ok: false, message: params.get("connect_error") || GENERIC };
  }
  return null;
}

/**
 * Takes the outcome out of the address bar once it has been shown, without adding a history entry.
 * A reload that replayed "YouTube connected" — or worse, an error long since fixed — would be
 * reporting the past as the present.
 */
export function clearConnectReturn(): void {
  const url = new URL(window.location.href);
  if (!readConnectReturn(url)) return;
  url.searchParams.delete("connected");
  url.searchParams.delete("connect_error");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
