## Parent PRD

`issues/prd-03-auth.md`

## What to build

The **override flow** (PRD-03 §1.2, §3): a "Use my own credentials" disclosure that reveals client
ID/secret fields (today's setup inputs, promoted), so a Workspace user can connect through their
own Internal consent screen or anyone can bypass the shared bundled client. The in-app OAuth flow
(012) then runs against the supplied client. Docker/headless keeps env + CLI script as this same
flow, headless.

## Acceptance criteria

- [x] "Use my own credentials" reveals client ID/secret inputs; saving uses them for the OAuth flow.
- [x] The redirect URI string (`http://localhost:53682/oauth2callback`) is shown for the user to register.
- [x] Secrets remain write-only over the wire (status returns booleans only).
- [x] Docker path unchanged (env/CLI documented as the headless override).

## Implementation notes

- **Precedence, not just persistence.** `connectYouTube` gained an optional `override` client that
  wins over the stored and bundled clients, so a just-typed client works on the very first connect
  before it has ever been persisted. Covered by a new `connect.test.ts` case (override > stored >
  bundled). The final refresh-token persist still writes the winning client's id/secret + token.
- **Override reaches the flow over the wire.** `POST /api/setup/oauth/start` now parses an optional
  `{ clientId, clientSecret }` body (zod `oauthStartBody`: both-or-neither, else 400) and passes it
  as the override; an empty body keeps the one-click bundled path. `oauth.run` grew an `override?`
  param threaded through `server.ts` → `connectYouTube`.
- **Redirect URI is a status field, not a UI constant.** `SetupStatus.redirectUri` (from the
  server's `OAUTH_REDIRECT`) keeps the shown string in lockstep with what the loopback actually
  listens on. No secret is added — booleans-only for credentials is preserved.
- **Host-split setup screen.** On Electron (`canConnect`) the "Use my own credentials" disclosure
  reveals client ID/secret only (no token paste) plus the redirect URI to register, and runs the
  in-app flow via `api.setup.connect({clientId, clientSecret})`. On headless/Docker (`!canConnect`)
  the original three-field paste form (id/secret/refresh token → save + restart) is unchanged — the
  env/CLI `get-refresh-token.mjs` path remains the documented headless override.

Verified: 138 tests pass; typecheck clean across shared/server/web; web builds; runtime smoke
confirmed `/status` returns `redirectUri`, an override consent URL carries the override client id
(not the bundled one), and a secret-only body 400s.

## Follow-ups

- The override disclosure lives only on first-run setup; issue 014 (settings page) / 015 (reauth
  banner) own re-entering it after configuration.

## Blocked by

- Blocked by `issues/012-auth-inapp-oauth-flow.md`

## User stories addressed

- User story 2, 5
