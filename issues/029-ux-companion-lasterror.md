## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

(Optional enhancement) Surface action errors on a Companion key (PRD-07 §6, #18). Today the module
logs `error.code`/`message` only to its log panel; add a **`lastError` Companion variable**
(code + message of the most recent failed action) so an operator can bind it to button text for
on-stream debugging (e.g. `INVALID_PRESET`, `MISSING_TEMPLATE_VARS`). Module bump; document how
errors surface.

## Acceptance criteria

- [ ] New `lastError` variable exposes the latest failed action's code + message.
- [ ] `companion:bump` (minor) in the same PR; documented in the guide/HELP.
- [ ] Guide explains: log panel by default, `lastError` variable if bound.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-07 §6 (#18).
