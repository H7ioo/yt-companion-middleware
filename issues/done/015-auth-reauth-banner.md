## Parent PRD

`issues/prd-03-auth.md`

## What to build

Reauth affordance (PRD-03 §4): when `cache.health === "auth_error"` the dashboard shows a
"YouTube connection lost — Reconnect" banner wired to the in-app flow (Electron) / the settings
page (Docker). On success, health re-evaluates and the banner clears. Offered **only** for
`auth_error`, never `degraded`/`offline`.

## Acceptance criteria

- [x] Banner appears on `auth_error` with a Reconnect action.
- [x] Reconnect runs the OAuth flow; a successful reconnect clears the banner on next refresh.
- [x] No reauth is offered for `degraded` or `offline`.

## Blocked by

- Blocked by `issues/012-auth-inapp-oauth-flow.md`

## User stories addressed

- User story 3
