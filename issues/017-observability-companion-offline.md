## Parent PRD

`issues/prd-06-observability.md`

## What to build

Thread `offline` through the Companion module (PRD-06 §1.2). Add the `offline` case to the
health-color feedback mapping (`main.js` / `src/transform.js`, helper unit-tested first per
AGENTS.md), bump the module version in the same PR, add an upgrade script if any value is
renamed/removed, and update the color table in `public/guide.html` +
`companion-module/companion/HELP.md`. The label must match the canonical glossary (021).

## Acceptance criteria

- [ ] Companion health feedback renders an `offline` color distinct from degraded/auth_error.
- [ ] `transform.js` helper for the mapping is unit-tested.
- [ ] `companion:bump` applied in the same PR; versions in sync; upgrade script added if needed.
- [ ] Guide + HELP.md color tables updated; label matches glossary.

## Blocked by

- Blocked by `issues/016-observability-offline-state.md`
- Blocked by `issues/021-ux-vocabulary-glossary.md`

## User stories addressed

N/A. See PRD-06 §1.2 and PRD-07 §2 (#10 parity).
