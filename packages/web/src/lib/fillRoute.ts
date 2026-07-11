/**
 * Parses the Companion deep-link route `GET /fill?preset=<id>&redirect=<url>` (PRD §6).
 * Pure: takes the location parts so it is testable without a DOM.
 */
export interface FillRoute {
  presetId: string;
  /** Where to bounce after a successful apply. Null when absent or not an http(s) URL. */
  redirect: string | null;
}

/** LAN-trust: any http(s) URL is an acceptable redirect target (no allowlist). */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Builds the absolute Companion deep-link `GET /fill?preset=<id>[&redirect=<url>]`.
 * Absolute so it pastes straight into a Companion HTTP action; a non-http(s)
 * redirect is dropped to mirror what {@link parseFillRoute} would accept.
 */
export function buildFillUrl(
  origin: string,
  presetId: string,
  redirect?: string | null,
): string {
  const params = new URLSearchParams({ preset: presetId });
  if (redirect && isHttpUrl(redirect)) params.set("redirect", redirect);
  return `${origin.replace(/\/$/, "")}/fill?${params.toString()}`;
}

export function parseFillRoute(loc: { pathname: string; search: string }): FillRoute | null {
  if (loc.pathname !== "/fill") return null;
  const params = new URLSearchParams(loc.search);
  const presetId = params.get("preset");
  if (!presetId) return null;
  const redirectRaw = params.get("redirect");
  return {
    presetId,
    redirect: redirectRaw && isHttpUrl(redirectRaw) ? redirectRaw : null,
  };
}
