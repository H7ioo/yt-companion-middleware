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
    target_conflict: s.targetConflict?.code ?? '',
    target_conflict_message: s.targetConflict?.message ?? '',
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
 * Builds the `Authorization` header carrying the module's device token, or nothing at all when no
 * token is configured. The hosted middleware issues device tokens (PRD-15 §2) and reads them off
 * `Authorization: Bearer` on both the HTTP requests and the WebSocket upgrade.
 *
 * The empty case is deliberately *no header* rather than a bare `Bearer `: the server refuses a
 * credential that was presented and rejected whatever its grace mode says, while silence is
 * exactly what grace mode admits and records. A LAN install with the field left blank must keep
 * working, so a blank field must look blank on the wire.
 * @param {unknown} token
 * @returns {Record<string, string>}
 */
export function bearerHeaders(token) {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  return trimmed ? { Authorization: `Bearer ${trimmed}` } : {};
}

/**
 * The headers for every HTTP call the module makes: the JSON content type, plus the device-token
 * credential when one is configured.
 * @param {unknown} token
 * @returns {Record<string, string>}
 */
export function apiHeaders(token) {
  return { 'Content-Type': 'application/json', ...bearerHeaders(token) };
}

/**
 * The `ws` client options for the state socket. A WebSocket handshake is an HTTP upgrade, so the
 * same bearer header rides along on it — the server checks both surfaces through one seam, and a
 * token sent on only one of them guards nothing.
 * @param {unknown} token
 * @returns {{ headers?: Record<string, string> }}
 */
export function wsHandshakeOptions(token) {
  const headers = bearerHeaders(token);
  return Object.keys(headers).length > 0 ? { headers } : {};
}

/**
 * The operator-facing explanation for a refused HTTP status, or `undefined` when the status is not
 * an authentication failure.
 *
 * The `/api/dashboard/*` list routes are *not* covered by the server's grace mode — only the action
 * bus and the state socket are (PRD-15 §4). So a blank or wrong token on a seeded deployment leaves
 * a module whose socket is up and whose dropdowns are empty, which reads as "the server has no
 * presets" unless the refusal is said out loud. Which of the two it is decides the wording: silence
 * needs a token, a rejected token needs a new one.
 * @param {number} status
 * @param {unknown} token
 * @returns {string | undefined}
 */
export function authErrorMessage(status, token) {
  if (status !== 401 && status !== 403) return undefined;
  const configured = typeof token === 'string' && token.trim() !== '';
  return configured
    ? `Device token rejected (HTTP ${status}) — it may be revoked, expired or mistyped. Paste a fresh one from Settings → Machines.`
    : `Device token required (HTTP ${status}) — this server has accounts. Paste a device token from Settings → Machines.`;
}

/**
 * The module's link to the middleware, as the key sees it.
 * @typedef {'connected' | 'connecting' | 'disconnected'} LinkState
 */

/**
 * True whenever the state socket is not up. Anything unrecognised counts as down: a key must
 * never read "fine" because the module forgot to say otherwise.
 * @param {unknown} link
 * @returns {boolean}
 */
export function isLinkDown(link) {
  return link !== 'connected';
}

/**
 * Maps the link state onto its variable values. On a laptop, losing the socket meant the machine
 * was off and the operator could see that. Hosted, it means the internet blinked while the stream
 * carries on perfectly — so the state has to be readable *on the key*, not just in Companion's
 * connections list (PRD-15 §4).
 * @param {unknown} link
 * @returns {{ link: LinkState, link_up: boolean }}
 */
export function linkVariables(link) {
  const known = link === 'connected' || link === 'connecting' ? link : 'disconnected';
  return { link: known, link_up: !isLinkDown(known) };
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

// The module's non-health key palette — every colour a key can show, defined once here (packed
// RGB) so main.js, presetButtons() and the guide's layout mocks all derive from the same source
// instead of re-hardcoding literals. Health-state colours live in HEALTH_COLORS / healthColor()
// above; these are the rest a rebrand would touch.
//
// The system is broadcast-console tally logic: idle keys sit on dark surfaces tinted by role
// (so a key's job reads even unlit), and saturated colour is reserved for live states. The
// active-preset highlight is violet, not green — green already means "healthy" on the health
// lamp, and two identical greens meaning different things is how keys get misread mid-service.
/** @type {{ onAir: number, busy: number, activePreset: number, apiOff: number, linkDown: number, presetIdle: number, indicator: number, imageCanvas: number, utility: number, privacy: number, caution: number, danger: number }} */
export const COMPANION_COLORS = {
  // Live states — saturated, white text
  onAir: rgb(220, 28, 28), // On Air — broadcast is live (tally red)
  busy: rgb(26, 98, 224), // Busy — an action is in flight
  activePreset: rgb(112, 46, 220), // Active-preset highlight (violet — green is the health lamp's)
  apiOff: rgb(232, 164, 12), // Kill switch engaged — amber, pair with black text
  // Server link lost — magenta, and magenta on purpose. Every other alarm colour on a deck is
  // already spoken for by something that is still *working*: tally red is on air, amber is the
  // kill switch, slate is health `offline` (the server saying it cannot reach YouTube). This one
  // means the module is not talking to the server at all, and the key it lights is lying about
  // everything else it shows.
  linkDown: rgb(190, 24, 140),
  // Idle surfaces — dark, tinted by role
  presetIdle: rgb(24, 27, 38), // a preset key at rest (cool indigo-charcoal)
  indicator: rgb(16, 18, 24), // passive indicators (on-air / busy) until they light
  imageCanvas: rgb(12, 13, 17), // image-feedback keys — near-black so the PNG owns the key
  utility: rgb(36, 52, 76), // steel blue — refresh-type actions
  privacy: rgb(16, 84, 90), // teal — visibility control
  caution: rgb(148, 88, 6), // amber-brown — undo
  danger: rgb(118, 26, 32), // deep maroon — the API kill switch at rest
};

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
      style: { text, size: '14', color: rgb(255, 255, 255), bgcolor: COMPANION_COLORS.presetIdle },
      steps: [{ down: [{ actionId: 'apply_preset', options: { presetId: p.id, vars: '' } }], up: [] }],
      feedbacks: [
        {
          feedbackId: 'active_preset',
          options: { presetId: p.id },
          style: { bgcolor: COMPANION_COLORS.activePreset, color: rgb(255, 255, 255) },
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
