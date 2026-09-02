## Parent PRD

`issues/prd-15-hosted-auth-and-accounts.md`

## What to build

A confirmation in front of changing the stream binding (`defaultStreamBoundId`), because it fails
silently and expensively: a wrong choice sends the show nowhere, and nothing looks broken until
nobody can watch.

Small and self-contained. It is a confirmation, **not** a role restriction — everyone here is
trusted; the risk is a mis-click, not a person.

The sibling confirmation from PRD-15 §1 — deleting a broadcast whose link has already been shared —
lands with PRD-16, since that action does not exist yet.

## Acceptance criteria

- [ ] Changing the stream binding requires an explicit confirmation naming what is changing from
      and to.
- [ ] Cancelling leaves the setting untouched.
- [ ] The confirmation is not bypassed by the Companion action path, if one exists for this setting.
- [ ] Confirming writes an audit entry (once `issues/050-durable-audit-log.md` has landed).

## Blocked by

- Blocked by `issues/043-identity-spine-seeded-admin-and-session.md`

## User stories addressed

- User story 9
