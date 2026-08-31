## Parent PRD

`issues/prd-15-hosted-auth-and-accounts.md`

## What to build

A record of who did what that survives a restart. PRD-15 §3.

**Kept separate from the existing activity feed**, which is not this and does not want to be:
`packages/server/src/core/logger.ts` documents itself as a 200-entry in-memory ring buffer, a live
feed that starts fresh on restart. It wants noise — polls, refreshes, health transitions — and it
stays exactly as it is. The audit log wants only what a person did. One store cannot serve both:
you get a feed too quiet to watch and a log too noisy to search.

- Append-only, on disk, in the existing data volume.
- One entry per human action: **who, what, which target, what happened, when.**
- Retention ~90 days, then trimmed, so it cannot grow without bound.
- **Never** a token, secret or credential value — a log is the thing most likely to be copied around.
- Admin-only viewer in the dashboard.
- Role and account changes are the entries that matter. "X changed the title" is routine; "X made
  Y an admin" is what someone will come looking for.

The actor comes from the issue 043 seam, so browser, app and device-token callers are all named
without each route working it out for itself.

## Acceptance criteria

- [ ] Every mutating action writes exactly one audit entry naming its actor.
- [ ] Entries survive a process restart.
- [ ] A device-token caller is named by its token name, not as "unknown".
- [ ] Entries older than the retention window are trimmed.
- [ ] A payload containing a secret is written to the log without the secret — asserted by test.
- [ ] The viewer is admin-only.
- [ ] The existing activity feed is unchanged in behaviour and capacity.

## Blocked by

- Blocked by `issues/043-identity-spine-seeded-admin-and-session.md`
- Blocked by `issues/045-roles-admin-and-user.md`

## User stories addressed

- User story 7
- User story 11
