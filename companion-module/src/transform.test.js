import { describe, expect, it } from 'vitest';
import {
  apiHeaders,
  authErrorMessage,
  bearerHeaders,
  categoryChoices,
  COMPANION_COLORS,
  formatLastError,
  healthColor,
  ingestionVariables,
  isLinkDown,
  joinUrl,
  linkVariables,
  mapVariables,
  nextApiEnabled,
  presetButtons,
  prepareBody,
  preparedVariables,
  presetChoices,
  resolveScheduledStart,
  streamChoices,
  toPng64,
  wsHandshakeOptions,
  wsUrl,
} from './transform.js';

const rgb = (r, g, b) => (r << 16) | (g << 8) | b;

describe('mapVariables', () => {
  it('maps the nested DashboardState onto variable values', () => {
    const vars = mapVariables(
      {
        status: {
          title: 'بث مباشر',
          privacyStatus: 'public',
          isLive: true,
          noTarget: false,
        },
        activePresetId: 'p1',
        displayLabel: 'أنوار الصحيح',
        health: 'ok',
        healthMessage: null,
        busy: false,
        apiEnabled: true,
        quota: { date: '2026-07-09', used: 1240, limit: 10000, remaining: 8760 },
        undo: { label: 'Prev title', capturedAt: '2026-07-09T00:00:00Z' },
      },
      [{ id: 'p1', title: 'Friday Khutbah', slug: 'khutbah' }],
    );
    expect(vars).toMatchObject({
      display_label: 'أنوار الصحيح',
      live_title: 'بث مباشر',
      active_preset_id: 'p1',
      active_preset_title: 'Friday Khutbah',
      is_live: true,
      no_target: false,
      privacy: 'public',
      health: 'ok',
      health_message: '',
      busy: false,
      api_enabled: true,
      quota_used: 1240,
      quota_limit: 10000,
      quota_remaining: 8760,
      undo_label: 'Prev title',
    });
  });

  it('leaves active_preset_title empty when the preset is not in the list', () => {
    const vars = mapVariables({ activePresetId: 'missing' }, [{ id: 'p1', title: 'X', slug: 's' }]);
    expect(vars.active_preset_title).toBe('');
  });

  it('fills safe defaults for a missing/partial payload', () => {
    const vars = mapVariables(undefined);
    expect(vars.display_label).toBe('');
    expect(vars.live_title).toBe('');
    expect(vars.is_live).toBe(false);
    expect(vars.quota_remaining).toBe(0);
    expect(vars.quota_used).toBe(0);
    expect(vars.api_enabled).toBe(true);
    expect(vars.undo_label).toBe('');
  });
});

describe('toPng64', () => {
  it('passes raw base64 through unchanged', () => {
    expect(toPng64('iVBORw0KGgo=')).toBe('iVBORw0KGgo=');
  });

  it('strips a data-URI prefix', () => {
    expect(toPng64('data:image/png;base64,iVBORw0KGgo=')).toBe('iVBORw0KGgo=');
  });

  it('returns undefined for null/empty/non-string', () => {
    expect(toPng64(null)).toBeUndefined();
    expect(toPng64('')).toBeUndefined();
    expect(toPng64('   ')).toBeUndefined();
    expect(toPng64(42)).toBeUndefined();
  });
});

describe('joinUrl', () => {
  it('joins without doubling or dropping the slash', () => {
    expect(joinUrl('http://h:8080', '/api/x')).toBe('http://h:8080/api/x');
    expect(joinUrl('http://h:8080/', '/api/x')).toBe('http://h:8080/api/x');
    expect(joinUrl('http://h:8080/', 'api/x')).toBe('http://h:8080/api/x');
  });
});

describe('wsUrl', () => {
  it('rewrites http → ws on the feedback ws endpoint', () => {
    expect(wsUrl('http://h:8080')).toBe('ws://h:8080/api/feedback/ws');
  });

  it('rewrites https → wss and tolerates a trailing slash on the base', () => {
    expect(wsUrl('https://h:8080/')).toBe('wss://h:8080/api/feedback/ws');
  });
});

describe('presetChoices', () => {
  it('labels with "slug · title" when the preset has a slug', () => {
    expect(presetChoices([{ id: 'p1', title: 'Friday Khutbah', slug: 'khutbah' }])).toEqual([
      { id: 'p1', label: 'khutbah · Friday Khutbah' },
    ]);
  });

  it('falls back to the title (then id) when there is no slug', () => {
    expect(presetChoices([{ id: 'p1', title: 'Friday Khutbah', slug: '  ' }])).toEqual([
      { id: 'p1', label: 'Friday Khutbah' },
    ]);
    expect(presetChoices([{ id: 'p2', slug: '' }])).toEqual([{ id: 'p2', label: 'p2' }]);
  });
});

describe('healthColor', () => {
  it('maps each health state to its distinct key color', () => {
    expect(healthColor('ok')).toBe(rgb(0, 140, 0)); // green
    expect(healthColor('degraded')).toBe(rgb(200, 120, 0)); // amber
    expect(healthColor('offline')).toBe(rgb(90, 98, 112)); // slate grey
    expect(healthColor('auth_error')).toBe(rgb(200, 0, 0)); // red
  });

  it('gives offline a colour distinct from degraded and auth_error', () => {
    expect(healthColor('offline')).not.toBe(healthColor('degraded'));
    expect(healthColor('offline')).not.toBe(healthColor('auth_error'));
  });

  it('falls back to a neutral colour for unknown/missing states', () => {
    const neutral = rgb(60, 66, 78);
    expect(healthColor(undefined)).toBe(neutral);
    expect(healthColor('bogus')).toBe(neutral);
  });
});

describe('formatLastError', () => {
  it('joins code and message as "CODE: message"', () => {
    expect(formatLastError({ code: 'INVALID_PRESET', message: 'no such preset' })).toBe(
      'INVALID_PRESET: no such preset',
    );
  });

  it('falls back to whichever half is present', () => {
    expect(formatLastError({ code: 'MISSING_TEMPLATE_VARS' })).toBe('MISSING_TEMPLATE_VARS');
    expect(formatLastError({ message: 'request failed: timeout' })).toBe('request failed: timeout');
  });

  it('trims whitespace and tolerates missing/blank/non-string fields', () => {
    expect(formatLastError({ code: '  BAD  ', message: '  broke  ' })).toBe('BAD: broke');
    expect(formatLastError({ code: '', message: '' })).toBe('unknown error');
    expect(formatLastError(undefined)).toBe('unknown error');
    expect(formatLastError({ code: 500, message: null })).toBe('unknown error');
  });
});

describe('nextApiEnabled', () => {
  it('enables when currently disabled', () => {
    expect(nextApiEnabled({ apiEnabled: false })).toBe(true);
  });

  it('disables when currently enabled', () => {
    expect(nextApiEnabled({ apiEnabled: true })).toBe(false);
  });

  it('treats unknown/missing state as enabled, so a toggle disables it', () => {
    expect(nextApiEnabled(undefined)).toBe(false);
    expect(nextApiEnabled({})).toBe(false);
  });
});

describe('presetButtons', () => {
  it('builds one drag-drop button per middleware preset, keyed apply_<id>', () => {
    const defs = presetButtons([{ id: 'p1', title: 'Friday Khutbah', slug: 'khutbah' }]);
    expect(Object.keys(defs)).toEqual(['apply_p1']);
    const b = defs.apply_p1;
    expect(b.type).toBe('button');
    expect(b.category).toBe('Apply preset');
    expect(b.name).toBe('Friday Khutbah');
  });

  it('labels the button with the slug, wires the apply action and the active-preset highlight', () => {
    const b = presetButtons([{ id: 'p1', title: 'Friday Khutbah', slug: 'khutbah' }]).apply_p1;
    expect(b.style.text).toBe('khutbah');
    expect(b.steps[0].down[0]).toMatchObject({ actionId: 'apply_preset', options: { presetId: 'p1' } });
    expect(b.feedbacks[0]).toMatchObject({ feedbackId: 'active_preset', options: { presetId: 'p1' } });
  });

  it('falls back to title then id for the button text', () => {
    expect(presetButtons([{ id: 'p1', title: 'T', slug: '  ' }]).apply_p1.style.text).toBe('T');
    expect(presetButtons([{ id: 'p2' }]).apply_p2.style.text).toBe('p2');
  });

  it('returns an empty map for no presets', () => {
    expect(presetButtons()).toEqual({});
    expect(presetButtons([])).toEqual({});
  });
});

describe('categoryChoices / streamChoices', () => {
  it('prefixes an "inherit default" entry', () => {
    const cats = categoryChoices([{ id: 'c1', title: 'Sports' }]);
    expect(cats[0]).toEqual({ id: '', label: '— inherit default —' });
    expect(cats[1]).toEqual({ id: 'c1', label: 'Sports' });

    const streams = streamChoices([{ id: 's1', title: 'Main', streamName: 'main' }]);
    expect(streams[0]).toEqual({ id: '', label: '— inherit default —' });
    expect(streams[1]).toEqual({ id: 's1', label: 'Main' });
  });
});

// --- Device token (issue 048 / PRD-15 §4) -----------------------------------
// The hosted server reads `Authorization: Bearer <token>` through one seam for both the HTTP
// requests and the WebSocket upgrade, so these helpers are the module's whole credential path.

describe('bearerHeaders', () => {
  it('builds an Authorization header from a token', () => {
    expect(bearerHeaders('ytm_abc123')).toEqual({ Authorization: 'Bearer ytm_abc123' });
  });

  it('trims surrounding whitespace — a token is copied once and pasted, often with a stray space', () => {
    expect(bearerHeaders('  ytm_abc123\n')).toEqual({ Authorization: 'Bearer ytm_abc123' });
  });

  // An empty field is the normal state on a LAN install and during the server's grace window:
  // sending `Bearer ` would be a *presented and rejected* credential, which the server refuses
  // whatever grace mode says. Sending nothing is what grace mode admits.
  it('sends no header at all when the token is empty, blank or missing', () => {
    for (const value of ['', '   ', undefined, null, 42, {}]) {
      expect(bearerHeaders(/** @type {any} */ (value))).toEqual({});
    }
  });
});

describe('apiHeaders', () => {
  it('always carries the JSON content type', () => {
    expect(apiHeaders('')).toEqual({ 'Content-Type': 'application/json' });
  });

  it('adds the bearer credential when a token is configured', () => {
    expect(apiHeaders('ytm_abc123')).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer ytm_abc123',
    });
  });
});

describe('authErrorMessage', () => {
  // Grace mode covers the action bus and the socket, never the `/api/dashboard/*` list routes, so a
  // blank token on a seeded server is a refusal the operator has to be told about.
  it('names a missing token when the field is blank', () => {
    for (const value of ['', '   ', undefined]) {
      expect(authErrorMessage(401, /** @type {any} */ (value))).toMatch(/Device token required/);
    }
  });

  it('names a rejected token when one was configured', () => {
    expect(authErrorMessage(401, 'ytm_abc123')).toMatch(/Device token rejected/);
    expect(authErrorMessage(403, 'ytm_abc123')).toMatch(/HTTP 403/);
  });

  it('stays out of the way of every other failure — those are not credential problems', () => {
    for (const status of [200, 400, 404, 429, 500, 503]) {
      expect(authErrorMessage(status, 'ytm_abc123')).toBeUndefined();
    }
  });
});

describe('wsHandshakeOptions', () => {
  it('passes the credential as a handshake header', () => {
    expect(wsHandshakeOptions('ytm_abc123')).toEqual({ headers: { Authorization: 'Bearer ytm_abc123' } });
  });

  // `new WebSocket(url, {})` and `new WebSocket(url)` behave identically, but an empty `headers`
  // object would be a lie about what the handshake carries.
  it('passes no headers when there is no token', () => {
    expect(wsHandshakeOptions('')).toEqual({});
    expect(wsHandshakeOptions(undefined)).toEqual({});
  });
});

// --- Server link state (issue 048 / PRD-15 §4) ------------------------------
// Hosted, losing the socket no longer means "the laptop is off" — it means the internet blinked
// while the stream carries on fine. The key must say so, distinctly from "connected but idle".

describe('linkVariables', () => {
  it('reports a connected link', () => {
    expect(linkVariables('connected')).toEqual({ link: 'connected', link_up: true });
  });

  it('reports connecting and disconnected as link-down', () => {
    expect(linkVariables('connecting')).toEqual({ link: 'connecting', link_up: false });
    expect(linkVariables('disconnected')).toEqual({ link: 'disconnected', link_up: false });
  });

  // A key must never read as "fine" because the module forgot to say otherwise.
  it('treats an unknown or missing state as down', () => {
    expect(linkVariables(undefined)).toEqual({ link: 'disconnected', link_up: false });
    expect(linkVariables('nonsense')).toEqual({ link: 'disconnected', link_up: false });
  });
});

describe('isLinkDown', () => {
  it('is false only while connected', () => {
    expect(isLinkDown('connected')).toBe(false);
    expect(isLinkDown('connecting')).toBe(true);
    expect(isLinkDown('disconnected')).toBe(true);
    expect(isLinkDown(undefined)).toBe(true);
  });
});

describe('COMPANION_COLORS.linkDown', () => {
  // It has to be legible as "not the same thing" next to every other state the deck can show —
  // tally red means on air, amber means the kill switch, slate means health `offline`.
  it('is distinct from every other colour in the palette', () => {
    const others = Object.entries(COMPANION_COLORS).filter(([name]) => name !== 'linkDown');
    for (const [, value] of others) expect(value).not.toBe(COMPANION_COLORS.linkDown);
    expect(COMPANION_COLORS.linkDown).not.toBe(healthColor('offline'));
    expect(COMPANION_COLORS.linkDown).not.toBe(healthColor('auth_error'));
  });
});

describe('ingestionVariables (issue 059)', () => {
  it('carries the server-resolved state and copy, so the module never classifies twice', () => {
    expect(
      ingestionVariables({
        ingestion: {
          state: 'problems',
          label: 'Arriving with problems',
          streamTitle: 'OBS key',
          checkedAt: '2026-09-02T18:00:00.000Z',
        },
      }),
    ).toEqual({
      ingestion_state: 'problems',
      ingestion_label: 'Arriving with problems',
      ingestion_key: 'OBS key',
      ingestion_checked_at: '2026-09-02T18:00:00.000Z',
    })
  })

  it('blanks every field when nothing has been read, rather than showing a stale key name', () => {
    expect(ingestionVariables({ ingestion: null })).toEqual({
      ingestion_state: '',
      ingestion_label: '',
      ingestion_key: '',
      ingestion_checked_at: '',
    })
  })

  it('survives a state frame from a server too old to send the field at all', () => {
    expect(ingestionVariables({}).ingestion_state).toBe('')
    expect(ingestionVariables(undefined).ingestion_state).toBe('')
  })
})

describe('mapVariables ingestion fields', () => {
  it('folds the ingestion readout in, so one state frame drives the key', () => {
    const vars = mapVariables({
      status: {},
      ingestion: { state: 'receiving', label: 'Receiving video', streamTitle: 'OBS key' },
    })
    expect(vars.ingestion_state).toBe('receiving')
    expect(vars.ingestion_label).toBe('Receiving video')
  })
})

describe('preparedVariables (issue 063)', () => {
  it('maps the prepared readout onto variables the key can print', () => {
    const vars = preparedVariables({
      prepared: {
        state: 'prepared',
        label: 'Prepared and bound',
        id: 'b1',
        title: 'Friday night',
        watchUrl: 'https://www.youtube.com/watch?v=b1',
        scheduledStartTime: '2026-09-03T19:00:00.000Z',
        streamId: 'stream-9',
      },
    });
    expect(vars).toEqual({
      prepared_state: 'prepared',
      prepared_label: 'Prepared and bound',
      prepared_id: 'b1',
      prepared_title: 'Friday night',
      prepared_url: 'https://www.youtube.com/watch?v=b1',
      prepared_start: '2026-09-03T19:00:00.000Z',
    });
  });

  // An old server that pushes no readout, or an early frame before the first push: the key must
  // read blank rather than "prepared".
  it('blanks every field when the frame carries no readout', () => {
    const vars = preparedVariables({});
    expect(vars.prepared_state).toBe('');
    expect(vars.prepared_url).toBe('');
    expect(vars.prepared_label).toBe('');
  });

  it('rides along on mapVariables, like the ingestion readout does', () => {
    const vars = mapVariables({ prepared: { state: 'none', label: 'Nothing prepared' } });
    expect(vars.prepared_state).toBe('none');
    expect(vars.prepared_label).toBe('Nothing prepared');
  });
});

describe('resolveScheduledStart (issue 063)', () => {
  // Deliberately mid-evening, so "19:00" is still ahead and "17:00" is behind.
  const NOW = Date.parse('2026-09-03T18:00:00.000Z');

  it('reads a clock time as tonight, in the time zone of the machine running Companion', () => {
    const at = new Date(NOW);
    const wanted = new Date(at);
    wanted.setHours(23, 30, 0, 0);
    const { iso, error } = resolveScheduledStart('23:30', NOW);
    expect(error).toBeUndefined();
    expect(iso).toBe(wanted.toISOString());
  });

  // The show is at 19:30 every week; the operator presses at 19:33 because they forgot. Rolling
  // that to tomorrow would schedule the broadcast for a day nobody asked for.
  it('keeps a clock time that has only just passed on today', () => {
    const at = new Date(NOW);
    at.setHours(at.getHours(), at.getMinutes() - 10, 0, 0);
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const { iso } = resolveScheduledStart(hhmm, NOW);
    expect(Date.parse(iso)).toBeLessThan(NOW);
    expect(NOW - Date.parse(iso)).toBeLessThan(60 * 60 * 1000);
  });

  it('rolls a clock time long past to tomorrow', () => {
    const at = new Date(NOW);
    at.setHours(at.getHours() - 5, 0, 0, 0);
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:00`;
    const { iso } = resolveScheduledStart(hhmm, NOW);
    expect(Date.parse(iso) - NOW).toBeGreaterThan(0);
    expect(Date.parse(iso) - NOW).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('takes a relative offset in minutes or hours', () => {
    expect(Date.parse(resolveScheduledStart('+30', NOW).iso)).toBe(NOW + 30 * 60_000);
    expect(Date.parse(resolveScheduledStart('+30m', NOW).iso)).toBe(NOW + 30 * 60_000);
    expect(Date.parse(resolveScheduledStart('+2h', NOW).iso)).toBe(NOW + 2 * 60 * 60_000);
  });

  it('takes "now" for a broadcast that starts as soon as the encoder does', () => {
    expect(Date.parse(resolveScheduledStart('now', NOW).iso)).toBe(NOW);
    expect(Date.parse(resolveScheduledStart('  NOW  ', NOW).iso)).toBe(NOW);
  });

  it('takes a full ISO timestamp unchanged', () => {
    expect(resolveScheduledStart('2026-12-24T21:00:00.000Z', NOW).iso).toBe('2026-12-24T21:00:00.000Z');
  });

  // A key press cannot ask a follow-up question, so the refusal has to name the forms that work.
  it('refuses a blank or unreadable time, and says what it accepts', () => {
    expect(resolveScheduledStart('', NOW).error).toMatch(/start time/i);
    expect(resolveScheduledStart('   ', NOW).error).toMatch(/start time/i);
    const bad = resolveScheduledStart('half seven', NOW);
    expect(bad.iso).toBeUndefined();
    expect(bad.error).toMatch(/19:30/);
  });

  it('refuses an out-of-range clock time rather than wrapping it', () => {
    expect(resolveScheduledStart('25:00', NOW).error).toBeTruthy();
    expect(resolveScheduledStart('19:75', NOW).error).toBeTruthy();
  });

  // `Date.parse('1930')` is a valid date — the first of January, 1930 — so the dropped colon in
  // `19:30` would sail through as a real start time and put a broadcast on the channel most of a
  // century ago. Bare digits are refused so the typo comes back as a message instead.
  it('refuses bare digits rather than reading them as a year', () => {
    for (const typo of ['1930', '730', '2026']) {
      const { iso, error } = resolveScheduledStart(typo, NOW);
      expect(iso).toBeUndefined();
      expect(error).toMatch(/19:30/);
    }
  });
});

describe('prepareBody (issue 063)', () => {
  const NOW = Date.parse('2026-09-03T18:00:00.000Z');

  it('sends the preset, its vars and the resolved start', () => {
    const { body, error } = prepareBody(
      { presetId: 'friday', vars: { name: 'Anwar' }, start: '2026-09-03T19:00:00.000Z' },
      NOW,
    );
    expect(error).toBeUndefined();
    expect(body).toEqual({
      presetId: 'friday',
      vars: { name: 'Anwar' },
      scheduledStartTime: '2026-09-03T19:00:00.000Z',
    });
  });

  // Every optional field is omitted rather than sent empty: the server's own fallback chain is
  // preset → app default, and a blank string would win over both and create an untitled broadcast.
  it('omits the fields the operator left alone', () => {
    const { body } = prepareBody(
      { presetId: 'friday', title: '', description: '  ', privacyStatus: '', category: '', streamId: '', start: 'now' },
      NOW,
    );
    expect(Object.keys(body).sort()).toEqual(['presetId', 'scheduledStartTime']);
  });

  it('carries the overrides that were filled in', () => {
    const { body } = prepareBody(
      {
        presetId: '',
        title: 'Ad-hoc evening',
        description: 'Doors at 7',
        privacyStatus: 'public',
        category: '24',
        streamId: 'stream-9',
        start: 'now',
      },
      NOW,
    );
    expect(body.title).toBe('Ad-hoc evening');
    expect(body.description).toBe('Doors at 7');
    expect(body.privacyStatus).toBe('public');
    expect(body.category).toBe('24');
    expect(body.streamId).toBe('stream-9');
    expect(body.presetId).toBeUndefined();
  });

  it('refuses a press with neither a preset nor a title, before it costs a write', () => {
    const { body, error } = prepareBody({ presetId: '', title: '', start: 'now' }, NOW);
    expect(body).toBeUndefined();
    expect(error).toMatch(/preset|title/i);
  });

  it('passes the start-time refusal straight through', () => {
    const { error } = prepareBody({ presetId: 'friday', start: 'half seven' }, NOW);
    expect(error).toMatch(/19:30/);
  });

  it('ignores unreadable vars JSON rather than dropping the press', () => {
    const { body, warning } = prepareBody({ presetId: 'friday', vars: 'not json', start: 'now' }, NOW);
    expect(body.presetId).toBe('friday');
    expect(body.vars).toBeUndefined();
    expect(warning).toMatch(/vars/i);
  });

  it('parses vars given as a JSON string, the way a key option carries them', () => {
    const { body } = prepareBody({ presetId: 'friday', vars: '{"name":"Anwar"}', start: 'now' }, NOW);
    expect(body.vars).toEqual({ name: 'Anwar' });
  });
});
