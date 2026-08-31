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

- [x] Accounts carry a role, and the seeded first account is an admin.
- [x] Every admin-only route refuses a user session and accepts an admin session.
- [x] Show-running routes accept both roles.
- [x] Demoting or removing the last admin is refused, with a clear message.
- [x] The dashboard does not render admin-only controls to a user.
- [x] Role checks read from the issue 043 actor seam, not from a per-route reimplementation.

## Blocked by

- Blocked by `issues/043-identity-spine-seeded-admin-and-session.md`

## User stories addressed

- User story 8

## Done — 2026-08-31

Shipped in `feat(auth): split the two roles, and audit the line between them`.

**The line is a table, not a habit.** `ADMIN_ONLY` in `packages/server/src/app.ts` names every
admin-only mount with a reason, exactly as `GUARD_EXEMPTIONS` names every unguarded one, and the
role audit in `guard.integration.test.ts` walks the *real* route table against it in both
directions: an admin guard with no entry fails, and an entry with no guard fails. Verified by
breaking it each way on purpose. Two mounts are on it — `/api/setup` and
`/api/dashboard/people` — and everything else is deliberately open to both roles, because
running the show is what a user account is for.

**`GET /api/setup/status` is mounted apart from the rest of `/api/setup`** and stays open to both
roles. It is read-only booleans, and the setup gate, the connection card and the reauth banner are
all built on it — a user who could not read it would face a dashboard that cannot say why nothing
works. Its own audit line covers it.

**The dashboard hides rather than offers-and-fails.** `canAdminister` in `web/src/lib/session.ts`
is the single display rule (always true where authentication is dormant, so desktop and LAN look
exactly as they did). It drives the connection card, the reauth banner's action, and the setup
gate — a user who arrives before the channel is connected gets `SetupPending`, not a setup screen
whose every button answers 403.

## Notes for the next slices

- **`removeAccount` is implemented and tested but has no route yet** — issue 046 owns removal, and
  wires it up alongside invites. It already drops the account's sessions, so the cut-off is
  immediate.
- **The people panel is roles-only.** `GET /api/dashboard/people` and `PUT
  /api/dashboard/people/:id/role` are live and used by the Settings panel; adding and removing
  people is 046's half of the same section.
- **The `/docs` console still documents four buses** (feedback, action, presets, config) and has
  never covered `/api/setup` or `/api/dashboard/people`, so nothing it claims became false here.
  A bus for them, with an "Admin only" badge alongside the existing "Sign-in required" one, is
  worth a docs slice.
- **Machine tokens are never admin** (PRD-15 §2). Issue 047 issues device tokens against this
  actor seam — a token's actor must resolve as a user, never an admin, and the `requireAdmin`
  guard is where that is enforced for free.
