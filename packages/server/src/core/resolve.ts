import type { DefaultSettings, Preset, PrivacyStatus } from "../storage/schema.js";

/**
 * The fields this app owns. Everything else on the YouTube broadcast/video is passed
 * through unchanged (PRD §6, Read-Modify-Write rule).
 */
export interface MetadataPayload {
  title?: string;
  description?: string;
  privacyStatus?: PrivacyStatus;
  /** Override; null/undefined => inherit app default. */
  category?: string | null;
  /** Override; null/undefined => inherit app default. */
  streamBoundId?: string | null;
}

/** Minimal shape of a YouTube liveBroadcast resource we read and mutate. */
export interface BroadcastResource {
  id?: string | null;
  snippet?: {
    title?: string | null;
    description?: string | null;
    [key: string]: unknown;
  } | null;
  status?: {
    privacyStatus?: string | null;
    [key: string]: unknown;
  } | null;
  contentDetails?: {
    boundStreamId?: string | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface ResolvedPlan {
  /**
   * Full broadcast object to PUT back via liveBroadcasts.update. All non-owned fields
   * (thumbnail, game id, etc.) are preserved from the GET.
   */
  broadcast: BroadcastResource;
  /** The categoryId to set (videos.update snippet.categoryId), or null to leave untouched. */
  categoryId: string | null;
  /** The stream to bind (liveBroadcasts.bind streamId), or null to leave untouched. */
  streamBoundId: string | null;
}

/** Turn a preset into a metadata payload. */
export function presetToPayload(preset: Preset): MetadataPayload {
  return {
    title: preset.title,
    description: preset.description,
    privacyStatus: preset.privacyStatus,
    category: preset.category,
    streamBoundId: preset.streamBoundId,
  };
}

/**
 * Field resolution order (PRD §3.3). Starts from the live GET, overlays owned fields,
 * and resolves category/streamBoundId as override -> app default -> leave untouched.
 *
 * `current` is deep-cloned so the input GET object is never mutated.
 */
export function resolve(
  current: BroadcastResource,
  payload: MetadataPayload,
  defaults: DefaultSettings,
): ResolvedPlan {
  const broadcast: BroadcastResource = structuredClone(current);

  // 4. Overlay title / description / privacyStatus from the payload (preset or ad-hoc).
  broadcast.snippet = broadcast.snippet ?? {};
  broadcast.status = broadcast.status ?? {};
  if (payload.title !== undefined) broadcast.snippet.title = payload.title;
  if (payload.description !== undefined) broadcast.snippet.description = payload.description;
  if (payload.privacyStatus !== undefined) broadcast.status.privacyStatus = payload.privacyStatus;

  // 2. category = preset override -> app default -> leave untouched.
  const categoryId = firstDefined(payload.category, defaults.defaultCategory);
  // 3. streamBoundId = preset override -> app default -> leave untouched.
  const streamBoundId = firstDefined(payload.streamBoundId, defaults.defaultStreamBoundId);

  return { broadcast, categoryId, streamBoundId };
}

/** Returns the first non-null/non-undefined value, or null if none. */
function firstDefined(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}
