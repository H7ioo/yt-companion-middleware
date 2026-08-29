## Parent PRD

`issues/prd-15-hosted-auth-and-accounts.md`

## What to build

The two-role split from PRD-15 §1. Two roles, and only two — per-feature permissions are a smell
that means a second workspace.

The dividing line: **if getting it wrong means a bad stream, it is a user action; if it means
losing control of the channel or the server, it is admin.**

- Admin: manage people and roles, manage device tokens, connect/disconnect YouTube, read the audit
  log.
- User: everything about the show — presets, title, description, privacy, category, going live,
  ending the stream, scheduling, requesting a fill.
- **The last admin cannot be removed or demoted.** Not a nicety; it is unrecoverable at 11pm.
- The UI hides what the signed-in person cannot do, rather than offering it and failing.

## Acceptance criteria

- [ ] Accounts carry a role, and the seeded first account is an admin.
- [ ] Every admin-only route refuses a user session and accepts an admin session.
- [ ] Show-running routes accept both roles.
- [ ] Demoting or removing the last admin is refused, with a clear message.
- [ ] The dashboard does not render admin-only controls to a user.
- [ ] Role checks read from the issue 043 actor seam, not from a per-route reimplementation.

## Blocked by

- Blocked by `issues/043-identity-spine-seeded-admin-and-session.md`

## User stories addressed

- User story 8
