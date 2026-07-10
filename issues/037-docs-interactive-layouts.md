## Parent PRD

`issues/prd-08-docs.md`

## What to build

The interactive **layouts** guide page (PRD-08 §3, #21): suggested Stream Deck button arrangements
rendered as inline vanilla-JS widgets driven by **mocked data — never real API calls**. The reader
can toggle mock state (go live, degraded/offline, busy) to see how a layout reacts. Reuses the
canonical vocabulary + health colors (021) so it matches the real app.

## Acceptance criteria

- [ ] A layouts page shows mock button faces (preset keys, live/idle, health lamp, busy).
- [ ] Toggling mock state updates the widgets client-side; no server/API/quota use.
- [ ] Colors/labels match the canonical source.

## Blocked by

- Blocked by `issues/035-docs-split-pages.md`
- Blocked by `issues/021-ux-vocabulary-glossary.md`

## User stories addressed

N/A. See PRD-08 §3 (#21).
