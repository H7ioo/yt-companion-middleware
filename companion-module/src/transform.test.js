import { describe, expect, it } from 'vitest';
import {
  categoryChoices,
  joinUrl,
  mapVariables,
  presetChoices,
  streamChoices,
  toPng64,
  wsUrl,
} from './transform.js';

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
