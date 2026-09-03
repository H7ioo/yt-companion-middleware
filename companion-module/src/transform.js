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
    ...ingestionVariables(s),
    ...preparedVariables(s),
  };
}

/**
 * The ingestion readout as Companion variables (issue 059) — is video actually arriving at
 * YouTube on the key OBS pushes to?
 *
 * The state and its label are taken from the frame as-is rather than derived here. The middleware
 * resolves them from the shared glossary before pushing, and a classifier duplicated in this
 * module — which is bundled standalone and cannot import that glossary — is a copy that would
 * drift the first time the mapping is corrected.
 *
 * `ingestion_checked_at` is not decoration: "receiving video" from twenty minutes ago is a fact
 * about twenty minutes ago, and a key that shows the state without the stamp is a key that says
 * the encoder is fine while OBS sits disconnected.
 * @param {Record<string, any> | undefined} state
 */
export function ingestionVariables(state) {
  const ingestion = state?.ingestion ?? null;
  return {
    ingestion_state: ingestion?.state ?? '',
    ingestion_label: ingestion?.label ?? '',
    ingestion_key: ingestion?.streamTitle ?? '',
    ingestion_checked_at: ingestion?.checkedAt ?? '',
  };
}

/**
 * The prepared-broadcast readout as Companion variables (issue 063) — is tonight's broadcast made,
 * and will the encoder reach it?
 *
 * The state and its words are taken from the frame as-is, for the same reason the ingestion
 * readout's are: the middleware resolves them from the shared glossary before pushing, and this
 * module is bundled standalone and cannot import that glossary. A classifier re-written here is a
 * copy that drifts the first time the wording is corrected.
 *
 * `prepared_url` is the one an operator actually asks for mid-setup — the link to send out — so it
 * is a variable a key can print rather than something only the dashboard holds.
 * @param {Record<string, any> | undefined} state
 */
export function preparedVariables(state) {
  const prepared = state?.prepared ?? null;
  return {
    prepared_state: prepared?.state ?? '',
    prepared_label: prepared?.label ?? '',
    prepared_id: prepared?.id ?? '',
    prepared_title: prepared?.title ?? '',
    prepared_url: prepared?.watchUrl ?? '',
    prepared_start: prepared?.scheduledStartTime ?? '',
  };
}

/** How long after a clock time has passed it is still read as today rather than tomorrow. */
const CLOCK_LOOKBACK_MS = 60 * 60 * 1000;

/**
 * Turns what an operator can type on a button option into the ISO instant the middleware needs
 * (issue 063).
 *
 * A key press cannot open a date picker, and YouTube requires a scheduled start on every broadcast
 * it creates — so the start time has to survive being typed once, months ago, into a button that
 * is pressed every week. That rules out an ISO timestamp as the everyday form: it names one date.
 * The forms that keep working are the ones relative to the press.
 *
 *   - `19:30`  — tonight at that time, in the time zone of the machine running Companion. Already
 *                past by less than an hour, it stays today: the operator who presses at 19:33 for
 *                a 19:30 show means tonight, and scheduling that a day out is not a small mistake.
 *                Past by more, it rolls to tomorrow — which is what a morning press for an evening
 *                repeat means.
 *   - `+45`, `+45m`, `+2h` — that far from now.
 *   - `now`    — immediately; the broadcast waits on the encoder.
 *   - a full ISO timestamp, for the one-off scheduled weeks ahead.
 *
 * Returns the instant or the refusal, never both, and the refusal names the forms — there is no
 * second chance to ask.
 * @param {unknown} raw
 * @param {number} nowMs
 * @returns {{ iso?: string, error?: string }}
 */
export function resolveScheduledStart(raw, nowMs) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return { error: 'No start time — a broadcast needs one. Try 19:30, +45m, now, or a full date and time.' };
  }
  const lower = text.toLowerCase();
  if (lower === 'now') return { iso: new Date(nowMs).toISOString() };

  const relative = /^\+\s*(\d+)\s*([mh]?)$/.exec(lower);
  if (relative) {
    const amount = Number(relative[1]);
    const ms = relative[2] === 'h' ? amount * 60 * 60_000 : amount * 60_000;
    return { iso: new Date(nowMs + ms).toISOString() };
  }

  const clock = /^(\d{1,2}):(\d{2})$/.exec(lower);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    if (hours > 23 || minutes > 59) {
      return { error: `“${text}” is not a time of day — hours run 0-23 and minutes 0-59.` };
    }
    const at = new Date(nowMs);
    at.setHours(hours, minutes, 0, 0);
    // Long past means they mean tomorrow; just past means they are running late.
    if (nowMs - at.getTime() > CLOCK_LOOKBACK_MS) at.setDate(at.getDate() + 1);
    return { iso: at.toISOString() };
  }

  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return { iso: new Date(parsed).toISOString() };
  return {
    error: `“${text}” is not a start time this understands. Try 19:30, +45m, now, or a full date and time.`,
  };
}

/**
 * Builds the body for POST /api/dashboard/broadcasts/prepare from a button's options (issue 063).
 *
 * Everything refusable is refused here, before the request: creating a broadcast is a write that
 * puts a public link into the world, and an insert that was going to fail anyway is a ghost on the
 * channel somebody has to clean up.
 *
 * Blank options are **omitted, never sent empty**. The server's fallback chain is the option, then
 * the preset's, then the app default — a blank string is a value and would win over both, which is
 * how a key would create an untitled broadcast out of a field nobody filled in.
 *
 * @param {{ presetId?: unknown, vars?: unknown, title?: unknown, description?: unknown, privacyStatus?: unknown, category?: unknown, streamId?: unknown, start?: unknown }} options
 * @param {number} nowMs
 * @returns {{ body?: Record<string, any>, error?: string, warning?: string }}
 */
export function prepareBody(options, nowMs) {
  const text = (/** @type {unknown} */ v) => (typeof v === 'string' ? v.trim() : '');
  const presetId = text(options?.presetId);
  const title = text(options?.title);
  if (!presetId && !title) {
    return { error: 'Nothing to prepare from — choose a preset, or type a title on the button.' };
  }

  const { iso, error } = resolveScheduledStart(options?.start, nowMs);
  if (error) return { error };

  /** @type {Record<string, any>} */
  const body = { scheduledStartTime: iso };
  if (presetId) body.presetId = presetId;
  if (title) body.title = title;
  const description = text(options?.description);
  if (description) body.description = description;
  const privacyStatus = text(options?.privacyStatus);
  if (privacyStatus) body.privacyStatus = privacyStatus;
  const category = text(options?.category);
  if (category) body.category = category;
  const streamId = text(options?.streamId);
  if (streamId) body.streamId = streamId;

  // Bad vars JSON does not cancel the press. The preset's own text is what gets used when a
  // variable is missing, and the server refuses the whole thing if one is genuinely unresolved —
  // so the honest outcome is to send the press without them and say so, not to swallow the button.
  let warning;
  const vars = options?.vars;
  if (vars && typeof vars === 'object') {
    body.vars = vars;
  } else {
    const rawVars = text(vars);
    if (rawVars) {
      try {
        body.vars = JSON.parse(rawVars);
      } catch (err) {
        warning = `Ignoring unreadable template vars JSON: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  return warning ? { body, warning } : { body };
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
