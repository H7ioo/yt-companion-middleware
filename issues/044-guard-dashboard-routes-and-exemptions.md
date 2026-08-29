## Parent PRD

`issues/prd-15-hosted-auth-and-accounts.md`

## What to build

Extend the guard from issue 043's single route across every browser-facing route, with an explicit
exemption list. See PRD-15 §6 for why placement is delicate.

**Companion-facing routes (`/api/action`, `/api/feedback`) are deliberately NOT touched here** —
guarding them without a module that can carry a token is the outage described in PRD-15 §4. They
are handled by issues 047 → 048 → 049.

Exemptions, each for a stated reason:

- `/api/feedback/health` stays open — Companion reads it as a liveness probe.
- The SPA catch-all (`/^(?!\/api\/).*/`) stays open — it serves the login page itself.
- `/api/setup` and `/api/dashboard/app` mount before the credentialed routes so they answer in
  setup mode; they become reachable to the seeded admin only, never to the public.

The test is a table over the **real** route table, in the spirit of PRD-05 §2.1, so that adding a
route without a guard fails CI rather than shipping.

## Acceptance criteria

- [ ] Every `/api/dashboard/*` route refuses an unauthenticated request.
- [ ] `/api/feedback/health` still answers without credentials.
- [ ] The login page still loads for a signed-out browser.
- [ ] Setup routes are reachable to the seeded admin and refused to everyone else.
- [ ] `/api/action` and `/api/feedback` are unchanged by this slice.
- [ ] A test enumerates the real route table and fails if a route is added without a guard or an
      explicit, commented exemption.

## Blocked by

- Blocked by `issues/043-identity-spine-seeded-admin-and-session.md`

## User stories addressed

- User story 10
- User story 11
