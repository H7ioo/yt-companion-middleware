# PRD-15 — Hosted deployment: accounts, roles, device tokens and an audit log

Source: the grilling session of 2026-08-29. The app moves off the operator's laptop and onto a VPS
behind a real domain. Every security assumption the codebase currently states in its own comments
stops being true on that day.

## Problem Statement

The server has no authentication. [`mountApiRoutes`](../packages/server/src/app.ts) says so in its
own comments — the Companion endpoints are "unauthenticated (LAN-only personal tool)", and the
dashboard routes carry no check either. The setup routes, which accept a Google client ID and
secret, mount even earlier. The process listens on `0.0.0.0`. The YouTube refresh token sits in
plaintext in `store.json`, justified by PRD-01 §6 on the grounds that disk access means the
operator is already compromised.

Those are reasonable positions for a tool that only exists on a home network. They are all false
on a rented host reachable at `yt.<domain>`.

Cloudflare Zero Trust in front is necessary and not sufficient. It authenticates *browsers* by
redirecting them to a login page. Two of the three clients here are not browsers: the Companion
module holds a WebSocket and posts actions over HTTP with no interactive session, and the planned
Android app (PRD-17) cannot sit inside that redirect comfortably either. Gate everything on
Cloudflare and both need exceptions — and the exceptions become the real security posture.

Three secondary problems arrive with hosting:

- **No identity means no accountability.** Three people will share one deployment. The existing
  activity log is explicitly *not* an audit log: [`logger.ts`](../packages/server/src/core/logger.ts)
  documents itself as a 200-entry in-memory ring buffer that starts fresh on restart.
- **The Companion link now crosses the internet.** One machine at home runs OBS and Companion. An
  ISP hiccup kills the control surface while the stream itself keeps running perfectly.
- **Server and module now drift.** On a laptop they upgrade together. Hosted, the server moves
  ahead on every push while the module in the field updates when someone remembers.

## Solution

**The app owns authentication. Cloudflare owns the network.**

Cloudflare provides the tunnel (so the origin is not reachable by IP), TLS, and rate limiting —
**and, in the steady state, nothing else** (issue 042). Cloudflare Access gates the dashboard only
as a construction fence while issues 043–045 are being built, and comes off the day app-level
enforcement is on; two doors on the browser path with no second door on the API path buys defence
in depth in name only, and every future access problem starts with "which lock refused me?". It is
never the only lock, and no API path depends on it. Every request that mutates anything carries an
identity the app issued and can revoke.

### 1. Accounts and roles

One workspace, one YouTube channel, several people. **Not multi-tenant** — each account does not
bring its own channel, credentials or quota, and making that possible is a different product.

Two roles, and only two:

| | Admin | User |
|---|---|---|
| Add/remove people, change roles | ✅ | ❌ |
| Create/revoke device tokens | ✅ | ❌ |
| Connect/disconnect YouTube | ✅ | ❌ |
| Read the audit log | ✅ | ❌ |
| Presets, title, description, privacy, category | ✅ | ✅ |
| Go live, end the stream, schedule/cancel broadcasts | ✅ | ✅ |
| Request a fill | ✅ | ✅ |

The dividing line: **if getting it wrong means a bad stream, it is a user action; if it means losing
control of the channel or the server, it is admin.**

Two actions get a confirmation regardless of role, because both fail silently and expensively:
changing the **stream binding** (a wrong choice sends the show nowhere), and **deleting a broadcast
whose link has already been shared** (it breaks the link for everyone who has it).

### 2. Getting in

- **Browsers** get a server-side session in an `httpOnly`, `SameSite` cookie. **Idle lifetime 30
  days, refreshed on every authenticated request; absolute lifetime 90 days, after which the
  password is typed again** (issue 042). Long-lived by design so nobody types a password mid-show;
  a device that goes quiet for a month falls off by itself. Revocable per device.
- **The Android app** gets a long-lived token tied to a user, held in the OS secure store and sent
  as a header. Issued by us, not by Cloudflare — this is the reason the app owns auth.
- **Companion** gets a **device token**: created in the dashboard, given a name, copied once,
  pasted into the module config. No login, no expiry, individually revocable. Sent on the HTTP
  requests *and* on the WebSocket handshake.

**Machine tokens are never admin.** A device token can run the show and nothing else. A token that
lives in a config file must not be able to add users.

**The first admin is seeded**, not claimed. A fresh public host with an open setup page is owned by
whoever finds it first, and bots find new hosts in minutes. The seed comes from configuration at
first boot; the open-claim path is never shipped.

**Removing someone cuts them off immediately** — their browser session and their app token both
stop working at once, not whenever they happen to lapse.

**The last admin cannot be removed or demoted.**

### 3. Audit log

A new, durable log, kept **separate** from the existing activity feed. The feed wants noise —
polls, refreshes, health transitions — and stays exactly as it is. The audit log wants only what a
person did.

- Append-only, on disk, in the existing data volume. Retention ~90 days, then trimmed.
- One line per human action: **who, what, which target, what happened, when.**
- Never a token, secret or credential value.
- Role and account changes are the entries that matter most — "X changed the title" is routine,
  "X made Y an admin" is what someone will come looking for.

It depends on §2: the server can only name an actor once requests carry identity. That is why this
ships as one piece rather than as a later addition.

### 4. Companion module changes — and the breakage they prevent

**The module cannot send a credential today, and that is deliberate.** Its entire config is a single
`url` field ([`main.js`](../companion-module/main.js)). v2.0.0 *removed* the Bearer-token field and
ships an upgrade script, `dropBearerToken`
([`upgrades.js`](../companion-module/src/upgrades.js)), that strips `token` from stored configs —
on the reasoning that the middleware had dropped auth entirely (PRD-02 §8, "LAN-only personal
tool").

So the day auth lands on `/api`, **every Companion install in the wild breaks, with no way to fix
itself**: the field it would need was deleted, and an old build cannot be configured with a token.
This PRD owns that migration.

- Re-add a token config field, threaded through the existing
  [`headers()`](../companion-module/main.js) seam and into the `ws` handshake options.
- **Append** a new upgrade script; never edit `dropBearerToken` (AGENTS.md hard rule). It seeds an
  empty token field so an upgraded install is configurable rather than silently unauthorised.
- **Minor version bump** in the same PR.
- **Rollout order matters more than the code.** Ship and install the token-carrying module version
  *before* the server starts enforcing, or run a grace period where an unauthenticated Companion
  connection is accepted and loudly warned about. Enforcing first means going dark on a show night.
  **Grace mode is the safer default**, because nobody can be relied on to update the module on a
  schedule.
- **The grace window must be observable, or it is just auth switched off.** If the server cannot say
  whether any client is still connecting without a token, there is no signal for when it is safe to
  enforce, and "temporary" becomes permanent. So: record every unauthenticated connection — when,
  from where, which client — surface it in the dashboard as a standing warning naming the offenders,
  and make **"no tokenless client has connected in 14 consecutive days, spanning at least one
  go-live"** the explicit exit condition (issue 042). Enforcement flips on evidence, not on a
  guess. Fourteen days because usage is show-shaped, not daily: a 7-day window can be one quiet
  week, and the Companion machine may only be powered up on show night. The readout must therefore
  show *days since the last tokenless connection*, not just a list.
- TLS itself is free: `transform.js` already rewrites `https:` to `wss:`, so a hosted HTTPS origin
  needs no transport work — only the credential is missing.
- The module must render the disconnected state unmistakably. Losing the server no longer means
  the laptop is off; it means the internet blinked while the stream carries on fine, and nobody
  should press a key into the void assuming it landed.

### 5. Connecting YouTube on a headless host

The in-app OAuth flow (PRD-03 §2) cannot run on a VPS. `server.ts` only constructs its `oauth`
object when the host passes an `openBrowser` function, and only Electron does — a headless boot has
no browser to open and no tray to return to. The env fallback in `config.ts` still works, so the
documented path is: mint the refresh token on a machine with a browser using
`scripts/get-refresh-token.mjs`, then feed `YT_CLIENT_ID` / `YT_CLIENT_SECRET` /
`YT_REFRESH_TOKEN` to the host.

That is acceptable for first boot and unacceptable as the steady state, because the hosted UI is now
the primary client and PRD-03 §3 promises a Settings page where an admin can reconnect. A
**browser-based connect flow served by the app itself** — consent in the admin's browser, callback
to the public origin, token stored server-side — is therefore in scope here. It needs a redirect URI
registered on the public domain, and it makes the OAuth client secret genuinely secret for the first
time (unlike the bundled desktop client, where PRD-03 §1.1 accepts that it is not).

### 6. Guard placement

`server.ts` mounts `/api/setup` and `/api/dashboard/app` *before* the credentialed routes so they
answer in setup mode, and a catch-all `/^(?!\/api\/).*/` serves the SPA. Whatever guards `/api`
must therefore:

- not lock out the setup routes before an admin exists (they are seeded, per §2, so setup itself
  must be reachable only to the seeded admin, not to the public);
- leave `/api/feedback/health` open, since Companion reads it as a liveness probe;
- not accidentally guard the SPA catch-all, which serves the login page itself.

### 7. Distribution (decided, no work in this PRD)

Companion accepts modules three ways: the public store, a hand-imported `.tgz`, and an offline
bundle. **There is no way to point it at a GitHub repo or any private source.** Auto-update through
the store therefore requires publishing publicly, which costs the ability to hotfix during a show
and invites strangers to install a module useless without this server.

**Decision: do not publish.** Use Companion's development-folder path plus a small script on the
Companion machine that pulls the latest release into it. One machine, twenty lines, same effect.

## User Stories

1. As an admin, I sign in once on my laptop and stay signed in, so that a show never starts with a
   password prompt.
2. As a user, I get an invite from an admin and set up my own access, so that nobody shares a login.
3. As an admin, I revoke one lost phone without touching anyone else's setup.
4. As an admin, I remove someone who has left and know they are out immediately.
5. As an admin, I create a named token for the Companion machine and paste it in once.
6. As an operator, I can see in Companion that the server is unreachable, so that I never press a
   key believing it landed.
7. As an admin, I can look back at who changed what last week, and the record survived a restart.
8. As an admin, I am the only one who can add people, change roles, or reconnect the channel.
9. As anyone, changing the stream binding asks me to confirm, so that I cannot silently send the
   show nowhere.
10. As the person deploying this, the first admin exists before the host is publicly reachable, so
    that nobody can claim my server.
11. As a developer, the identity of every mutating request is available to the audit log without
    each route inventing its own way to find it.

## Implementation Decisions

_Proposed — starting position for review, not settled fact._

- **Auth in the app, not the edge.** Cloudflare stays as tunnel, TLS and rate limiting. No API path
  trusts a Cloudflare header as proof of identity.
- **Origin not reachable by IP.** The tunnel is the only door; the host firewall closes the rest.
- **One workspace, many users.** Single channel and single credential set stay as they are.
- **Two roles, hard stop.** Per-feature permissions are a smell that means a second workspace.
- **Sessions for browsers, bearer tokens for everything else.** Cookies are `httpOnly` and
  `SameSite`, which also closes today's cross-site risk: a logged-in browser must not let an
  arbitrary web page fire an action.
- **No email infrastructure.** Invites are expiring links an admin generates and hands over.
  Password reset is a fresh invite. No mail server, no verification flow.
- **Audit log is append-only on disk, separate from the ring buffer.** Not retrofitted into
  `Logger`, whose contract is deliberately ephemeral.
- **Rate-limit and lock out authentication attempts**, and never reveal whether an account exists.

## Testing Decisions

- **Every mutating route rejects an unauthenticated request.** A table-driven test over the real
  route table (as PRD-05 §2.1 already does for mounting) so a new route cannot be added unguarded.
- `/api/feedback/health` stays reachable without credentials; nothing else does.
- **Role boundaries:** a user token is refused on every admin action; an admin token is accepted.
- **Device tokens are never admin**, under any construction.
- **Revocation is immediate:** a revoked session/token fails the very next request.
- **The last admin cannot be removed or demoted.**
- **Audit entries carry the actor** for browser, app and device-token callers alike, and survive a
  restart.
- **No secret ever reaches the audit log** — asserted against a payload containing one.
- **Module upgrade path:** a config saved by the current (tokenless) module version still loads
  after the token field is re-added, and the new upgrade script leaves `dropBearerToken` untouched.
- **Grace mode:** while enabled, an unauthenticated Companion connection is accepted, recorded and
  warned about; once disabled, it is refused. The recorded warning names the client, so the exit
  condition is checkable rather than assumed.
- **Guard placement:** the health probe and the SPA login page stay reachable unauthenticated; the
  setup routes do not.

## Out of Scope

- Multi-tenant / multiple channels per deployment.
- Two-factor, passkeys, SSO.
- Email delivery of any kind.
- The mobile client itself (PRD-17).
- Broadcast features (PRD-16).

## Further Notes

- **Settled (issue 042) — the refresh token stays in plaintext, with the hosted threat model
  restated.** Encryption with a key supplied at boot defends against an attacker who takes the disk
  or a snapshot but not the process environment — and on a single VPS the key would have to live in
  the env file or the systemd unit on that same disk, so a snapshot takes both. A key from outside
  the host is the only version that works, and typing one at boot breaks unattended restarts, which
  is unacceptable for a tool that must come back up on show night. So the hosted threat model is
  stated instead: **`store.json` is a secret, and anyone who can read the data volume or a backup of
  it owns the channel.** The compensating controls are cheaper and actually hold — `0600` on the
  data volume under the service user, snapshots and backups handled as secret material, `store.json`
  never in a log or a support bundle, and a written response for suspected host compromise (revoke
  in the Google account, reconnect through issue 052, which makes rotation two clicks rather than a
  scripted chore). Raised as `issues/067-refresh-token-at-rest-hardening.md`.
- **Open consequence — API compatibility.** Once the server updates on every push and the module
  updates when someone remembers, the server must keep answering older modules, or breakage must be
  announced loudly. This is a new discipline, not an existing one.
- **One stated motivation does not survive scrutiny.** "The laptop is overwhelmed" is not a reason
  this move helps: the middleware is a 60-second poll loop and an HTTP server — near-zero load.
  Hosting genuinely buys availability from anywhere, a real domain and TLS without hand-managing a
  reverse proxy on a busy machine; it does not buy the laptop meaningful headroom. Worth saying out
  loud so nobody is disappointed by the result. **OBS and Companion stay on the laptop regardless** —
  they need LAN protocols and local USB — so only the middleware moves.
- **Ordering.** This ships before PRD-16 and before PRD-17. The audit log falls out of it almost
  free; the mobile app cannot start without it.
