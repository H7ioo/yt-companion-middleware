// @ts-check
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
  const num = (/** @type {unknown} */ v) => (typeof v === 'number' ? v : 0);
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
 * Formats a failed action's error into the single string bound to the `last_error` variable, so an
 * operator can put the latest failure (e.g. `INVALID_PRESET`, `MISSING_TEMPLATE_VARS`) on a key for
 * on-stream debugging. Prefers `CODE: message`; falls back to whichever half is present, then a
 * generic label. Tolerates a missing/partial envelope (a transport failure carries only a message).
 * @param {{ code?: unknown, message?: unknown } | undefined | null} error
 * @returns {string}
 */
export function formatLastError(error) {
  const code = typeof error?.code === 'string' ? error.code.trim() : '';
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  if (code && message) return `${code}: ${message}`;
  return code || message || 'unknown error';
}

/**
 * Given the latest DashboardState, returns what the API master switch (kill switch) should become
 * on a toggle: enable when it is currently off, otherwise disable. An unknown/missing state is
 * treated as "on", so a first toggle turns it off.
 * @param {Record<string, any> | undefined} state
 * @returns {boolean}
 */
export function nextApiEnabled(state) {
  return state?.apiEnabled === false;
}

// Local RGB packer — same math as the SDK's combineRgb, kept here so this module stays SDK-free
// and unit-testable. `(r << 16) | (g << 8) | b`.
const rgb = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) => (r << 16) | (g << 8) | b;

// Canonical key colour per health state. `offline` (issue 017 / PRD-06 §1.2) is deliberately a
// muted slate — a "no link" grey, distinct from `degraded` amber and `auth_error` red, so a
// firewalled rig no longer reads as an auth failure. Unknown states fall back to a dark neutral.
/** @type {Record<string, number>} */
const HEALTH_COLORS = {
  ok: rgb(0, 140, 0), // green
  degraded: rgb(200, 120, 0), // amber
  offline: rgb(90, 98, 112), // slate grey
  auth_error: rgb(200, 0, 0), // red
};

/**
 * Maps a middleware health state onto its canonical Companion key colour (packed RGB). This is the
 * single source of truth the health feedbacks recolor from, so every state — including `offline` —
 * renders a distinct, consistent colour.
 * @param {string | undefined} status
 * @returns {number}
 */
export function healthColor(status) {
  return HEALTH_COLORS[status ?? ''] ?? rgb(60, 66, 78);
}

/**
 * Builds Companion **preset buttons** (the drag-drop templates in the Presets tab) — one per
 * middleware preset. Each arrives already labelled with the preset's slug/title, already wired to
 * the `apply_preset` action, and already carrying the `active_preset` highlight feedback, so an
 * operator drops it on a key and it applies + self-labels + lights up when active with no config.
 * Returned in the `CompanionPresetDefinitions` shape expected by `setPresetDefinitions`.
 * @param {Array<{ id: string, title?: string, slug?: string }>} presets
 * @returns {Record<string, any>}
 */
export function presetButtons(presets) {
  /** @type {Record<string, any>} */
  const defs = {};
  for (const p of presets ?? []) {
    const slug = p.slug?.trim();
    const text = slug || p.title || p.id;
    defs[`apply_${p.id}`] = {
      type: 'button',
      category: 'Apply preset',
      name: p.title || p.id,
      style: { text, size: 'auto', color: rgb(255, 255, 255), bgcolor: rgb(30, 33, 40) },
      steps: [{ down: [{ actionId: 'apply_preset', options: { presetId: p.id, vars: '' } }], up: [] }],
      feedbacks: [
        {
          feedbackId: 'active_preset',
          options: { presetId: p.id },
          style: { bgcolor: rgb(0, 140, 0), color: rgb(255, 255, 255) },
        },
      ],
    };
  }
  return defs;
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
