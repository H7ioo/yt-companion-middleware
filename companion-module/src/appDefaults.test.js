import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The confirmation in front of the default stream binding (issue 051) lives in the dashboard, which
 * only holds as long as the dashboard is the only way to change it. Companion has no screen and no
 * confirmation, so a key that wrote the app default would walk straight past the guard.
 *
 * This is the teeth on that: the module reaches `/api/settings` nowhere, and never names
 * `defaultStreamBoundId`. Its own `streamBoundId` option is a different thing — the binding for the
 * one broadcast an action writes, sent on `/api/action/update`, which the app default is only the
 * fallback for.
 */
const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

describe('the Companion module never writes the app defaults (issue 051)', () => {
  it('calls no settings route', () => {
    expect(main).not.toMatch(/\/api\/settings/);
  });

  it('never names the default stream binding', () => {
    expect(main).not.toMatch(/defaultStreamBoundId/);
  });

  it('still offers the per-action binding, which is not the app default', () => {
    expect(main).toMatch(/body\.streamBoundId = a\.options\.streamBoundId/);
    expect(main).toMatch(/'\/api\/action\/update'/);
  });
});
