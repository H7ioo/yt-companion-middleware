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

- [x] Every `/api/dashboard/*` route refuses an unauthenticated request.
- [x] `/api/feedback/health` still answers without credentials.
- [x] The login page still loads for a signed-out browser.
- [x] Setup routes are reachable to the seeded admin and refused to everyone else.
- [x] `/api/action` and `/api/feedback` are unchanged by this slice.
- [x] A test enumerates the real route table and fails if a route is added without a guard or an
      explicit, commented exemption.

## Blocked by

- Blocked by `issues/043-identity-spine-seeded-admin-and-session.md`

## User stories addressed

- User story 10
- User story 11

## Done — 2026-08-30

Shipped in `feat(auth): guard every dashboard route behind one prefix`.

Decisions worth carrying forward:

- **One prefix guard, not twelve per-mount guards.** `app.use("/api/dashboard", requireSession())`
  sits above the dashboard mounts, so the default for a route added below it is *closed*.
  Repeating the guard per mount would have made "forgot the guard" the likely failure — which is
  exactly the failure this slice exists to remove.
- **The audit walks the real express router stack.** `guard.integration.test.ts` recovers every
  mount path out of `app._router.stack` and fires a real unauthenticated request at each; anything
  that is not a 401 must appear in `GUARD_EXEMPTIONS` with a stated reason. Both failure modes were
  checked by breaking them on purpose: removing the guard, and adding an unlisted route. There is a
  self-check test too, so a regexp-parsing slip that returned an empty table cannot make the audit
  pass vacuously.
- **`server.ts` no longer mounts routes inline.** Its boot-mode mounts moved to `mountBootRoutes`
  and its SPA/static mount to `mountWebApp`, both in `app.ts`. Without that the audit would have
  been checking a hand-rolled copy of the route table — the drift PRD-05 §2.1 warns about.
- **The Companion deep link now sits behind sign-in** (`main.tsx`). `FillPage` reads
  `/api/dashboard/presets` and `/api/dashboard/action/preset`; leaving it outside the gate meant a
  phone opening the ntfy link on a hosted host landed on a bare "Request failed (401)". It still
  skips the setup gate.

## Note for issues 047 → 049

**The Companion module calls five `/api/dashboard/*` routes, not just `/api/action` and
`/api/feedback`**, and this slice has now closed all five on a seeded deployment:

- `GET /api/dashboard/presets`, `/api/dashboard/categories`, `/api/dashboard/streams` — dropdown
  population on config load (`companion-module/main.js`)
- `PUT /api/dashboard/service` — the API kill switch action
- `POST /api/dashboard/fill-request` — the "Request fill" action

PRD-15 §4 frames the token work around the Companion base only. **Grace mode (047) and enforcement
(049) must cover these five as well**, or a token-carrying module still goes dark on a hosted host.
No live deployment is affected today: authentication is dormant until an admin is seeded, and no
hosted install exists yet.

Still open, as scoped: roles are stored but unenforced (045), and the seeded admin cannot change
its own password (noted in 043).
