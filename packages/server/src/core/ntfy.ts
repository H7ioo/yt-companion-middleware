import type { NotifyState, Preset } from "@app/shared";

const TIMEOUT_MS = 5000;

/** The `/fill` deep link the notification opens — mirrors web/src/lib/fillRoute.ts buildFillUrl. */
export function fillLink(baseUrl: string, presetId: string): string {
  const params = new URLSearchParams({ preset: presetId });
  return `${baseUrl.replace(/\/$/, "")}/fill?${params.toString()}`;
}

/**
 * Pushes a tap-to-fill notification to the operator's ntfy topic (see notifySchema). Companion
 * cannot open a browser on any device — this is the path that reaches a locked phone: tapping
 * the notification opens the fill page. Best-effort, single attempt: by the time a retry would
 * land, the operator has either seen the dashboard popup or walked to the machine.
 *
 * Returns true on acceptance so the route can log delivery honestly.
 */
export async function pushFillNotification(
  notify: NotifyState,
  preset: Preset,
  baseUrl: string,
  doFetch: typeof fetch = fetch,
): Promise<boolean> {
  const topic = notify.ntfyTopic.trim();
  if (!topic) return false;
  const url = notify.ntfyServer.replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // ntfy's JSON publish format (POST to the server root, topic in the body), NOT the header
    // format: HTTP headers only carry Latin-1, so an Arabic preset title — or even the curly
    // quotes below — makes fetch throw before the request leaves the machine. JSON is UTF-8.
    const res = await doFetch(url, {
      method: "POST",
      body: JSON.stringify({
        topic,
        title: `Fill “${preset.title}”`,
        message: "Tap to fill and apply on this phone.",
        click: fillLink(baseUrl, preset.id),
        priority: 4, // "high"
        tags: ["pencil"],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[ntfy] ${url} responded ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[ntfy] push to ${url} failed: ${String(err)}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
