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
    expect(UpgradeScripts).toHaveLength(2);
    expect(UpgradeScripts[0].name).toBe('dropBearerToken');
    expect(UpgradeScripts[1].name).toBe('seedDeviceToken');
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

// v2.3.0 re-adds the token field that v2.0.0 removed, because the hosted server now issues device
// tokens (PRD-15 §4). The prior shape is `{ url }`; the shape it migrates to is `{ url, token }`.
// It seeds an *empty* token so an upgraded install is configurable, never silently credentialled.
describe('seedDeviceToken (v2.0.0 -> v2.3.0)', () => {
  const seedDeviceToken = UpgradeScripts[1];

  it('adds an empty token field to a tokenless v2 config', () => {
    const result = run(seedDeviceToken, { url: 'http://10.0.0.5:3000' });
    expect(result.updatedConfig).toEqual({ url: 'http://10.0.0.5:3000', token: '' });
  });

  it('keeps every other stored field intact', () => {
    const result = run(seedDeviceToken, { url: 'http://x:3000', label: 'Studio' });
    expect(result.updatedConfig).toEqual({ url: 'http://x:3000', label: 'Studio', token: '' });
  });

  // The pair matters: dropBearerToken runs first on a v1.x config and strips the old token, then
  // this seeds the new empty one. An operator upgrading straight from v1.x lands on the v2.3 shape
  // with a blank field, not with a v1 token silently resurrected as a device credential — those
  // are different secrets issued by different systems.
  it('leaves a v1.x config on the v2.3 shape when run after dropBearerToken', () => {
    const stored = { url: 'http://x:3000', token: 'a-v1-bearer' };
    const afterDrop = run(UpgradeScripts[0], stored).updatedConfig;
    expect(run(seedDeviceToken, afterDrop).updatedConfig).toEqual({ url: 'http://x:3000', token: '' });
  });

  it('reports no change when a token field is already present', () => {
    expect(run(seedDeviceToken, { url: 'http://x:3000', token: '' }).updatedConfig).toBeNull();
    expect(run(seedDeviceToken, { url: 'http://x:3000', token: 'ytm_abc' }).updatedConfig).toBeNull();
  });

  it('never overwrites a token an operator already pasted in', () => {
    const result = run(seedDeviceToken, { url: 'http://x:3000', token: 'ytm_keepme' });
    expect(result.updatedConfig).toBeNull();
  });

  it('survives a null config without throwing', () => {
    expect(() => run(seedDeviceToken, null)).not.toThrow();
    expect(run(seedDeviceToken, null).updatedConfig).toBeNull();
  });

  it('migrates no actions or feedbacks — nothing was renamed or removed', () => {
    const result = run(seedDeviceToken, { url: 'http://x:3000' });
    expect(result.updatedActions).toEqual([]);
    expect(result.updatedFeedbacks).toEqual([]);
  });
});
