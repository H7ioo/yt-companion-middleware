## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

Two guide fixes (PRD-07 §8/§9). (#16) Update the stale "72×72" PNG size to the real **288×288**
(72px logical face supersampled 4×, `titleImage.ts` `SIZE=72`/`SCALE=4`) and explain the
supersample rationale. (#22) Fix the CSS overflow of the API text in the "apply (submit fires)"
card in the fill-flow section so it wraps inside the card (`overflow-wrap`/`word-break` +
`max-width`); the guide must not scroll horizontally at narrow widths.

## Acceptance criteria

- [ ] Guide states 288×288 (with the supersample explanation); no remaining "72×72".
- [ ] The "apply (submit fires)" card contains its API text at narrow widths.
- [ ] No horizontal page scroll introduced.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-07 §8 (#16), §9 (#22).
