import { describe, expect, it } from 'vitest';
import { UpgradeScripts } from './upgrades.js';

// Companion identifies each upgrade step by its *index* in this array and stores, per connection,
// how many it has already run. Editing or reordering an entry therefore re-points a migration an
// operator has already applied, and inserting one in the middle re-runs the wrong step against the
// wrong config shape (VERSIONING.md, "Don't break existing buttons"). These tests are the teeth on
// that rule: the array is append-only, and each step is exercised against the shape it migrates
// *from*, not the shape it produces.

/** Companion hands the script a context object; none of our steps read it. */
const context = /** @type {any} */ ({});

/** @param {unknown} config */
const run = (script, config) => script(context, { config: /** @type {any} */ (config), actions: [], feedbacks: [] });

describe('UpgradeScripts array', () => {
  it('is a non-empty ordered array of functions', () => {
    expect(Array.isArray(UpgradeScripts)).toBe(true);
    expect(UpgradeScripts.length).toBeGreaterThan(0);
    for (const script of UpgradeScripts) expect(typeof script).toBe('function');
  });

  // Pinning the length is the point: this test failing means someone appended (fine — extend the
  // suite below with that step's own cases) or, far worse, spliced into the middle (not fine).
  it('holds exactly the migration history shipped so far', () => {
    expect(UpgradeScripts).toHaveLength(1);
    expect(UpgradeScripts[0].name).toBe('dropBearerToken');
  });

  it('never mutates the config it is handed', () => {
    const stored = { url: 'http://10.0.0.5:3000', token: 'secret' };
    const snapshot = structuredClone(stored);
    for (const script of UpgradeScripts) run(script, stored);
    expect(stored).toEqual(snapshot);
  });

  it('always returns the three result arrays Companion expects', () => {
    for (const script of UpgradeScripts) {
      for (const config of [{ url: 'http://x:3000', token: 't' }, { url: 'http://x:3000' }, null]) {
        const result = run(script, config);
        expect(Array.isArray(result.updatedActions)).toBe(true);
        expect(Array.isArray(result.updatedFeedbacks)).toBe(true);
      }
    }
  });
});

// v2.0.0 removed the Bearer-token config field. The prior shape is `{ url, token }`; the shape it
// migrates to is `{ url }`.
describe('dropBearerToken (v1.x -> v2.0.0)', () => {
  const dropBearerToken = UpgradeScripts[0];

  it('strips the stale token from a v1.x config', () => {
    const result = run(dropBearerToken, { url: 'http://10.0.0.5:3000', token: 'abc123' });
    expect(result.updatedConfig).toEqual({ url: 'http://10.0.0.5:3000' });
    expect(result.updatedConfig).not.toHaveProperty('token');
  });

  it('keeps every other stored field intact', () => {
    const result = run(dropBearerToken, { url: 'http://10.0.0.5:3000', token: 'abc123', label: 'Studio' });
    expect(result.updatedConfig).toEqual({ url: 'http://10.0.0.5:3000', label: 'Studio' });
  });

  it('strips an empty-string token, which a v1.x operator could have saved', () => {
    const result = run(dropBearerToken, { url: 'http://x:3000', token: '' });
    expect(result.updatedConfig).toEqual({ url: 'http://x:3000' });
  });

  // Returning null tells Companion "nothing changed" — cheaper than rewriting an identical config,
  // and it keeps the connection's stored config byte-identical.
  it('reports no change for a config already on the v2 shape', () => {
    expect(run(dropBearerToken, { url: 'http://x:3000' }).updatedConfig).toBeNull();
  });

  it('reports no change for an empty config', () => {
    expect(run(dropBearerToken, {}).updatedConfig).toBeNull();
  });

  // Companion can invoke an upgrade on a connection that has no saved config yet.
  it('survives a null config without throwing', () => {
    expect(() => run(dropBearerToken, null)).not.toThrow();
    expect(run(dropBearerToken, null).updatedConfig).toBeNull();
  });

  it('migrates no actions or feedbacks — the removed check_connection action has no replacement', () => {
    const result = run(dropBearerToken, { url: 'http://x:3000', token: 't' });
    expect(result.updatedActions).toEqual([]);
    expect(result.updatedFeedbacks).toEqual([]);
  });
});
