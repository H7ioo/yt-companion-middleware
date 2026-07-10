## Parent PRD

`issues/prd-03-auth.md`

## What to build

The **override flow** (PRD-03 §1.2, §3): a "Use my own credentials" disclosure that reveals client
ID/secret fields (today's setup inputs, promoted), so a Workspace user can connect through their
own Internal consent screen or anyone can bypass the shared bundled client. The in-app OAuth flow
(012) then runs against the supplied client. Docker/headless keeps env + CLI script as this same
flow, headless.

## Acceptance criteria

- [ ] "Use my own credentials" reveals client ID/secret inputs; saving uses them for the OAuth flow.
- [ ] The redirect URI string (`http://localhost:53682/oauth2callback`) is shown for the user to register.
- [ ] Secrets remain write-only over the wire (status returns booleans only).
- [ ] Docker path unchanged (env/CLI documented as the headless override).

## Blocked by

- Blocked by `issues/012-auth-inapp-oauth-flow.md`

## User stories addressed

- User story 2, 5
