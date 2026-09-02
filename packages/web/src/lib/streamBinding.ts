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

/**
 * How a bound id reads to a person: the picker's label when the stream is on the channel, the
 * bare id when it is not, and words rather than an empty string when nothing is bound.
 *
 * "not a live stream" is only claimed when there is a list to make the claim against — before the
 * streams have loaded, an unrecognised id is unrecognised because we have not looked yet.
 */
export function bindingLabel(boundId: string | null, streams: StreamInfo[]): string {
  if (boundId == null) return "not set";
  const match = streams.find((s) => s.id === boundId);
  if (match) return streamOptionLabel(match);
  return isStaleBinding(boundId, streams) ? `id ${boundId} (not a live stream)` : `id ${boundId}`;
}

/** The two sides of a pending binding change, or null when the value is not actually changing. */
export interface BindingChange {
  from: string;
  to: string;
  /** True when the change unbinds — the case with no visible symptom at all until air. */
  clearing: boolean;
}

/**
 * Describes a change to the default stream binding so it can be confirmed before it is saved
 * (issue 051). A wrong binding sends the show nowhere and nothing looks broken until nobody can
 * watch it, so the confirmation has to name what is being changed *from* as well as *to* —
 * "are you sure?" alone tells the operator nothing they did not already know.
 */
export function describeBindingChange(
  from: string | null,
  to: string | null,
  streams: StreamInfo[],
): BindingChange | null {
  if (from === to) return null;
  return {
    from: bindingLabel(from, streams),
    to: bindingLabel(to, streams),
    clearing: to == null,
  };
}
