// Pure helpers for the YT Companion middleware module. Kept free of the Companion SDK so they
// can be unit-tested directly (see transform.test.js) without a running Companion instance.

/**
 * Maps the middleware's `/api/feedback/active-preset` JSON onto Companion variable values.
 * Tolerates missing fields (e.g. an early poll before the cache is warm).
 * @param {Record<string, any>} state
 */
export function mapVariables(state) {
  const s = state ?? {};
  return {
    display_label: s.displayLabel ?? '',
    live_title: s.title ?? '',
    active_preset_id: s.activePresetId ?? '',
    is_live: Boolean(s.isLive),
    no_target: Boolean(s.noTarget),
    privacy: s.privacyStatus ?? '',
    health: s.health ?? '',
    busy: Boolean(s.busy),
    api_enabled: s.apiEnabled !== false,
    quota_remaining: typeof s.quotaRemaining === 'number' ? s.quotaRemaining : 0,
  };
}

/**
 * Normalises a middleware PNG field into the base64 string Companion's `png64` expects: strips
 * a `data:image/...;base64,` prefix if present and trims whitespace. Returns undefined when
 * there is no usable image, so a feedback can fall through to no override.
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function toPng64(value) {
  if (typeof value !== 'string') return undefined;
  const stripped = value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').trim();
  return stripped.length > 0 ? stripped : undefined;
}

/**
 * Joins a base URL and path without doubling or dropping the slash between them.
 * @param {string} base
 * @param {string} path
 */
export function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}
