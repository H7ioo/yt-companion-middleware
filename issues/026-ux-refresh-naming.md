## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

Disambiguate the two "refresh" actions everywhere (PRD-07 §5, #19): **Refresh state** (force a live
YouTube GET, `/api/action/refresh`) vs **Refresh lists** (re-fetch presets/categories/streams).
Apply the two canonical labels (from the glossary) to the dashboard buttons, the Companion action
names, and the guide. Companion label changes → module bump.

## Acceptance criteria

- [ ] Dashboard, Companion, and guide use distinct, canonical labels for the two refresh actions.
- [ ] Any Companion action rename carries a `companion:bump` + upgrade script in the same PR.
- [ ] Labels come from the glossary (021).

## Blocked by

- Blocked by `issues/021-ux-vocabulary-glossary.md`

## User stories addressed

N/A. See PRD-07 §5 (#19).
