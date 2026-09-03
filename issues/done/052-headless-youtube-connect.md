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

## Progress note — 2026-09-03

Built and verified against a running server. All acceptance criteria are met in code; the one step
that cannot be done from here is the HITL step this issue already named — registering the redirect
URI on a Google Cloud OAuth client.

**Done**

- `PUBLIC_ORIGIN` is the switch. Setting it is what makes the flow exist, because knowing the
  origin Google redirects back to *is* the definition of a hosted deployment. Parsing is strict and
  fails at boot: a malformed origin costs nothing until consent, where it surfaces as
  `redirect_uri_mismatch` in a browser, minutes in and far from the cause.
- `youtube/hostedOAuth.ts` inverts the loopback flow. The server hands out a consent URL, the
  admin's own browser does the consent, Google returns it to `/api/setup/oauth/callback`. The
  loopback catcher could only ever be reached by the browser on this machine; a public callback can
  be reached by anyone, so the flow carries a `state` nonce — unguessable, single-use, 10-minute
  TTL, and refused *before* any token exchange. Without it a planted authorization code would
  connect someone else's channel to this deployment.
- Unfinished attempts are capped at 16, oldest evicted, and swept on expiry. Each one holds a
  client secret, and "Connect" is a button that gets clicked repeatedly when nothing seems to
  happen.
- Both endpoints sit under the existing `/api/setup` mount, so `ADMIN_ONLY` and the guard audit in
  `guard.integration.test.ts` cover them with no new exemption. The callback is a *navigation*, so
  both outcomes are a redirect to `/?connected=youtube` or `/?connect_error=…` — a JSON error body
  would land the admin on a page of machine text.
- The refresh token is written straight to the store and hot-applied through the same late-bound
  `applyCredentials` the desktop flow uses, so the YouTube client is rebuilt in-process and
  Companion's connection survives a reconnect. `complete()` resolves with nothing, so the token has
  no route back to a browser.
- `SetupStatus.canConnect` became `connectMode` (`in-app` | `redirect` | null). The two flows are
  driven differently — one holds a request open, the other navigates away — and a boolean that
  could not tell them apart would offer a button that dead-ends on one of the two hosts. Status
  also reports the redirect URI for whichever flow is live, since it is copied by hand.
- Dashboard: the setup screen, the Settings connection card and the reauth banner all run consent
  the way the server says they can. On a hosted host none of them ask for a refresh token any more.
  `lib/connectReturn.ts` reads the outcome off the URL of the load that follows, then clears it so
  a reload does not replay a stale message.
- Documented in `.env.example` and the operator guide's Install & run section, including the exact
  redirect URI to register and why a mismatch is invisible until consent.

**Still HITL**

- Registering `<PUBLIC_ORIGIN>/api/setup/oauth/callback` on a Google Cloud OAuth client, and setting
  `PUBLIC_ORIGIN` on the real deployment. The guide and the dashboard both show the exact string;
  nothing in the repo can do this step. Worth pre-flighting the client with
  `scripts/get-refresh-token.mjs` first — it is still the only way to catch a wrong secret before
  the consent screen.
