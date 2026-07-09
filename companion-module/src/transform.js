// Pure helpers for the YT Companion middleware module. Kept free of the Companion SDK so they
// can be unit-tested directly (see transform.test.js) without a running Companion instance.

/**
 * Maps the middleware's nested `DashboardState` (as carried by the WebSocket `state` frame) onto
 * Companion variable values. Tolerates a missing/partial state (e.g. an early frame before the
 * server's first push). `presets` is used to resolve `active_preset_title` from `activePresetId`.
 * @param {Record<string, any>} state
 * @param {Array<{ id: string, title?: string }>} [presets]
 */
export function mapVariables(state, presets = []) {
  const s = state ?? {};
  const status = s.status ?? {};
  const quota = s.quota ?? {};
  const num = (v) => (typeof v === 'number' ? v : 0);
  const active = (presets ?? []).find((p) => p.id === s.activePresetId);
  return {
    display_label: s.displayLabel ?? '',
    live_title: status.title ?? '',
    active_preset_id: s.activePresetId ?? '',
    active_preset_title: active?.title ?? '',
    is_live: Boolean(status.isLive),
    no_target: Boolean(status.noTarget),
    privacy: status.privacyStatus ?? '',
    health: s.health ?? '',
    health_message: s.healthMessage ?? '',
    busy: Boolean(s.busy),
    api_enabled: s.apiEnabled !== false,
    quota_used: num(quota.used),
    quota_limit: num(quota.limit),
    quota_remaining: num(quota.remaining),
    undo_label: s.undo?.label ?? '',
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

/**
 * Builds the middleware's WebSocket state endpoint from the HTTP base URL, forcing the protocol
 * to `ws:` (from `http:`) or `wss:` (from `https:`).
 * @param {string} base
 * @returns {string}
 */
export function wsUrl(base) {
  const u = new URL(joinUrl(base, '/api/feedback/ws'));
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

/**
 * Turns the middleware's preset list into Companion dropdown choices. Labels prefer
 * `slug · title`, falling back to the title, then the raw id.
 * @param {Array<{ id: string, title?: string, slug?: string }>} presets
 */
export function presetChoices(presets) {
  return (presets ?? []).map((p) => ({
    id: p.id,
    label: p.slug?.trim() ? `${p.slug} · ${p.title}` : p.title || p.id,
  }));
}

/**
 * Summarises the middleware's `/api/feedback/health` response (the "YouTube status" liveness
 * check) into a one-line log message and an `ok` flag. Used by the "Check middleware connection"
 * action. Tolerates an undefined payload (unreachable middleware).
 * @param {Record<string, any> | undefined} health
 * @returns {{ ok: boolean, text: string }}
 */
export function summarizeHealth(health) {
  if (!health) return { ok: false, text: 'no response from middleware' };
  const ok = health.authenticated !== false && health.status !== 'auth_error';
  const parts = [
    `health ${health.status ?? 'unknown'}`,
    health.authenticated === false ? 'NOT authenticated' : 'authenticated',
    `API ${health.apiEnabled === false ? 'disabled' : 'enabled'}`,
    `quota ${health.quotaRemaining ?? '?'}/${health.quotaLimit ?? '?'}`,
  ];
  if (health.message) parts.push(String(health.message));
  return { ok, text: parts.join(' · ') };
}

/**
 * Category dropdown choices with a leading "inherit default" (empty id) entry so the update
 * action can leave the field unchanged.
 * @param {Array<{ id: string, title?: string }>} categories
 */
export function categoryChoices(categories) {
  return [
    { id: '', label: '— inherit default —' },
    ...(categories ?? []).map((c) => ({ id: c.id, label: c.title ?? c.id })),
  ];
}

/**
 * Stream (bound-broadcast) dropdown choices with a leading "inherit default" entry.
 * @param {Array<{ id: string, title?: string }>} streams
 */
export function streamChoices(streams) {
  return [
    { id: '', label: '— inherit default —' },
    ...(streams ?? []).map((s) => ({ id: s.id, label: s.title ?? s.id })),
  ];
}
