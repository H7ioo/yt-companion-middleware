## Parent PRD

`issues/prd-06-observability.md`

## What to build

The health explainer (PRD-06 §4, #6): an inline tooltip/expandable on the dashboard health
indicator naming the current state and its meaning — `ok` / `degraded` / `offline` / `auth_error`
— drawn from the single canonical copy source (glossary, 021) and reused in the guide.

## Acceptance criteria

- [ ] Health indicator explains the current state in plain language.
- [ ] `degraded` clearly reads as transient/retrying; `offline` links to the firewall panel; `auth_error` links to reconnect.
- [ ] Copy comes from the canonical source and matches the guide.

## Blocked by

- Blocked by `issues/016-observability-offline-state.md`
- Blocked by `issues/021-ux-vocabulary-glossary.md`

## User stories addressed

N/A. See PRD-06 §4 (#6).
