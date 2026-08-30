## Parent PRD

`issues/prd-15-hosted-auth-and-accounts.md`

## What to build

The thinnest complete path through authentication, end to end: an account exists, a person signs
in, a session proves who they are, and exactly **one** route enforces it. Everything else stays
open until issue 044.

Deliberately thin. Session handling is the part most likely to be got wrong, so it lands on its own
and is verified before anything depends on it.

- Account records in the store (id, name, credential, role field present but unused until 045).
- **The first admin is seeded at boot from configuration** — never claimed through an open setup
  page. A fresh public host with an unclaimed setup screen belongs to whoever finds it first
  (PRD-15 §2).
- A login page in the web app, and sign-out.
- A server-side session in an `httpOnly`, `SameSite` cookie: **30 days idle, refreshed on every
  authenticated request, with a 90-day absolute cap** (settled in issue 042).
  `SameSite` also closes today's cross-site risk: a signed-in browser must not let an arbitrary web
  page fire an action.
- One route — pick `/api/dashboard/settings` — actually guarded, to prove the chain.
- A single seam that answers "who is asking?", so later slices (044, 047, 050) do not each invent
  their own.

## Acceptance criteria

- [ ] A seeded admin exists on first boot without any interactive claim step.
- [ ] Signing in with the seeded credential returns a session; signing out invalidates it.
- [ ] The guarded route succeeds with a session and is refused without one.
- [ ] The cookie is `httpOnly` and `SameSite`; a cross-site request cannot use it.
- [ ] Every other route behaves exactly as it does today (no accidental lockout).
- [ ] The "current actor" seam is exported and unit-tested, ready for 044/047/050.
- [ ] Failed sign-in attempts are rate-limited and never reveal whether an account exists.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 1
- User story 10
- User story 11
