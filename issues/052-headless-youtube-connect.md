## Parent PRD

`issues/prd-15-hosted-auth-and-accounts.md`

## What to build

Let an admin connect or reconnect the YouTube channel from the hosted dashboard. PRD-15 §5.

**Why it does not work today.** `server.ts` only constructs its `oauth` object when the host passes
an `openBrowser` function, and only Electron does. A headless boot has no browser to open and no
tray to return to. The env fallback in `config.ts` still works, so first boot can use a refresh
token minted elsewhere with `scripts/get-refresh-token.mjs` — acceptable to start, unacceptable as
the steady state now that the hosted UI is primary and PRD-03 §3 promises a Settings page that can
reconnect.

- Consent happens in the admin's own browser, at the real `accounts.google.com` — never an embedded
  webview.
- The callback lands on the public origin; the token is stored server-side and never exposed to the
  browser or to Companion.
- The YouTube client is rebuilt in-process on success, without a restart (PRD-03 §2.4).
- Secrets stay write-only over the wire: status returns booleans, never values.

HITL: someone must register the public redirect URI on a Google Cloud OAuth client. This is also
where the client secret becomes genuinely secret for the first time — unlike the bundled desktop
client, where PRD-03 §1.1 accepts that it is not.

## Acceptance criteria

- [ ] An admin can start the connect flow from the dashboard on a headless host.
- [ ] The public redirect URI is registered and documented for anyone redeploying.
- [ ] On success the refresh token is stored server-side and the YouTube client is rebuilt without
      a restart.
- [ ] A non-admin cannot start the flow.
- [ ] The connection status is visible without exposing any secret value.
- [ ] Google returning no refresh token gives the existing revoke-and-retry guidance.
- [ ] The `auth_error` reconnect banner (PRD-03 §4) routes here on the hosted deployment.

## Blocked by

- Blocked by `issues/045-roles-admin-and-user.md`

## User stories addressed

- User story 8
