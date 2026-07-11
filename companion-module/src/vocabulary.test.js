import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Companion module can't import @app/shared at runtime (it's bundled standalone), so its copy is
// hand-aligned to the glossary (issue 021) instead. This guard is the alignment's teeth: it fails if
// the shipped strings drift off the two canonical refresh labels — the exact "refresh cache vs
// refresh list" ambiguity issue 026 (PRD-07 §5, #19) exists to kill.
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const REFRESH_STATE = 'Refresh from YouTube'; // ACTION_GLOSSARY.refreshState.label
const REFRESH_LISTS = 'Refresh lists'; //        ACTION_GLOSSARY.refreshLists.label

describe('companion refresh vocabulary (issue 026)', () => {
  const surfaces = {
    'main.js': read('../main.js'),
    'HELP.md': read('../companion/HELP.md'),
    'README.md': read('../README.md'),
  };

  for (const [name, text] of Object.entries(surfaces)) {
    it(`${name} names the state refresh canonically`, () => {
      expect(text).toContain(REFRESH_STATE);
    });

    it(`${name} names the list refresh canonically`, () => {
      expect(text).toContain(REFRESH_LISTS);
    });

    it(`${name} never uses the pre-021 "Refresh cache" label`, () => {
      expect(text).not.toMatch(/Refresh cache/i);
    });
  }

  it('binds each canonical label to its own action id', () => {
    const main = surfaces['main.js'];
    // Distinct actions: force a live GET vs re-pull the picker lists.
    expect(main).toMatch(/refresh:\s*{[^}]*Refresh from YouTube/s);
    expect(main).toMatch(/refresh_lists:\s*{[^}]*Refresh lists/s);
  });
});
