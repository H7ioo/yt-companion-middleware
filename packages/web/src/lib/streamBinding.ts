import type { StreamInfo } from "../api.js";

/**
 * A bound stream id is "stale" when it is set, we actually have a stream list to
 * check against, and no live stream on the channel carries that id — the binding
 * would silently fail at trigger time. An unset id (inherits the default) is never stale.
 */
export function isStaleBinding(boundId: string | null, streams: StreamInfo[]): boolean {
  return boundId != null && streams.length > 0 && !streams.some((s) => s.id === boundId);
}

/** Human label for a stream option: `title — streamName`, dropping the key when absent. */
export function streamOptionLabel(stream: StreamInfo): string {
  return stream.streamName ? `${stream.title} — ${stream.streamName}` : stream.title;
}
