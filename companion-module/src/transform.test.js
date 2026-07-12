import { describe, expect, it } from 'vitest';
import {
  categoryChoices,
  formatLastError,
  healthColor,
  joinUrl,
  mapVariables,
  nextApiEnabled,
  presetButtons,
  presetChoices,
  streamChoices,
  summarizeHealth,
  toPng64,
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

describe('summarizeHealth', () => {
  it('reports ok when authenticated and API enabled', () => {
    const r = summarizeHealth({
      status: 'ok',
      authenticated: true,
      apiEnabled: true,
      quotaRemaining: 8760,
      quotaLimit: 10000,
    });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('ok');
    expect(r.text).toContain('authenticated');
    expect(r.text).toContain('8760/10000');
  });

  it('is not ok when auth failed', () => {
    const r = summarizeHealth({ status: 'auth_error', authenticated: false, message: 'token expired' });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('auth_error');
    expect(r.text).toContain('token expired');
  });

  it('handles a missing/unreachable response', () => {
    const r = summarizeHealth(undefined);
    expect(r.ok).toBe(false);
    expect(r.text).toContain('no response');
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
