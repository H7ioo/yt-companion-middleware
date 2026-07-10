## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

Clarify the action-route split (PRD-07 §3, #12): keep **both** bases (they serve different callers
through a shared handler — `/api/action/*` = Companion, `/api/dashboard/action/*` = dashboard),
correct the misleading PRD-02 note, and document the split as intentional in a server comment and
the guide. No deprecation, no companion bump.

## Acceptance criteria

- [ ] Server code + guide state the two bases are by-caller and both supported.
- [ ] The misleading "wired to either path historically" framing is corrected.
- [ ] No route removed; no companion bump.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-07 §3 (#12).
