# 004 — Drop Bearer auth (LAN-only)

## Parent PRD

`issues/prd.md`

## What to build

Remove the Bearer token entirely, since this is a LAN-only personal tool (PRD §8). Delete
the auth middleware, the token routes and helpers, the token field in the store schema, and
the token panel in the dashboard UI. Serve every endpoint unauthenticated. Keep both
`/api/action` and `/api/dashboard/action` mounted as unauthenticated aliases to the same
handler so existing Companion buttons on either path keep working.

This slice is independent of the template work and can be grabbed at any time.

## Acceptance criteria

- [x] `bearerAuth` (`src/auth/bearerMiddleware.ts`), `src/auth/apiToken.ts`, and the token
      routes (`src/routes/token.ts`, `/api/dashboard/token` mount) are removed.
- [x] `tokenRecordSchema` and the `token` field are removed from the store schema; existing
      store files still load (the stale `token` key is ignored, not fatal).
- [x] The token panel is removed from the dashboard UI, along with any first-run
      generate-a-token flow.
- [x] `/api/action/*` and `/api/dashboard/action/*` both work without any Authorization
      header and hit the same handlers.
- [x] `/api/feedback/*` and the SSE stream endpoints work without a token.
- [x] Server starts cleanly and existing tests pass (auth-specific tests removed or
      updated); no dead imports/references to the removed auth code remain.

## Blocked by

None - can start immediately (independent of the template slices).

## User stories addressed

- User story 8
