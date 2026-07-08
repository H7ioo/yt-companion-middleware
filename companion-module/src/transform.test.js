import { describe, expect, it } from 'vitest';
import { joinUrl, mapVariables, toPng64 } from './transform.js';

describe('mapVariables', () => {
  it('maps the active-preset payload onto variable values', () => {
    const vars = mapVariables({
      displayLabel: 'أنوار الصحيح',
      title: 'بث مباشر',
      activePresetId: 'p1',
      isLive: true,
      noTarget: false,
      privacyStatus: 'public',
      health: 'ok',
      busy: false,
      apiEnabled: true,
      quotaRemaining: 8760,
    });
    expect(vars).toMatchObject({
      display_label: 'أنوار الصحيح',
      live_title: 'بث مباشر',
      active_preset_id: 'p1',
      is_live: true,
      privacy: 'public',
      quota_remaining: 8760,
      api_enabled: true,
    });
  });

  it('fills safe defaults for a missing/partial payload', () => {
    const vars = mapVariables(undefined);
    expect(vars.display_label).toBe('');
    expect(vars.is_live).toBe(false);
    expect(vars.quota_remaining).toBe(0);
    expect(vars.api_enabled).toBe(true);
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
