# PRD — In-App OAuth, Credential Management & Reauth

Covers grill-me items **#2** (OAuth login → refresh token straight to DB), **#5** (reauth
on auth error), **#7** (settings page to change credentials), **#9** (env → DB storage).

Builds on the current auth surface: `src/config.ts` (`resolveCredentials`, `isConfigured`),
`src/storage/schema.ts` (`credentialsSchema`), `src/routes/setup.ts`, `src/youtube/client.ts`,
and the CLI helper `scripts/get-refresh-token.mjs`.

---

## 0. What already exists (do not rebuild)

- Credentials already persist in the DB (`store.credentials`), with env/`.env` as **fallback**
  only (`resolveCredentials`). Item **#9 is effectively done** — env is already the fallback,
  not the source of truth.
- The setup screen (`src/routes/setup.ts` + `web/src/components/SetupScreen.tsx`) already writes
  `clientId` / `clientSecret` / `refreshToken` to the DB and reboots. This is the seed of the
  **#7 settings page** and the **override flow** below.
- The full OAuth dance already works in `scripts/get-refresh-token.mjs` (loopback catcher on
  `:53682`, `access_type=offline`, `prompt=consent`, scope `youtube`). The in-app flow **reuses
  this exact logic**, just moved into the Electron main process.

The only genuinely new work is: **fold the OAuth dance into the app so no one copies a refresh
token by hand**, add a **reauth affordance**, and turn setup into a **first-class settings page**.

---

## 1. The account-type reality (why two flows exist)

The `youtube` scope is a Google **sensitive** scope. Refresh-token lifetime depends on the OAuth
consent screen's publishing status, **not** on who owns the client:

- Consent screen in **"Testing"** → refresh tokens **expire after 7 days**. Unacceptable for a
  streaming tool. Never ship this.
- Consent screen **"Internal"** (requires a Google Workspace org; all users in that org) →
  non-expiring tokens, no user cap, no verification, no warning screen.
- Consent screen **"External" + published to "Production"** while still **unverified** →
  non-expiring tokens, **≤100 users**, one-time "Google hasn't verified this app" warning.
  Personal `@gmail.com` accounts must use this path.

This app controls a **mixed estate** (some Workspace, some Gmail channels), so we ship **two
flows**:

### 1.1 Bundled flow (default, one-click)

- One OAuth client **owned by the project maintainer**, consent screen **External + Production
  (unverified)**. Works for *every* account type (Workspace users can consent to an External app
  too), gives non-expiring tokens, capped at ≤100 users, one warning screen.
- The bundled **client ID + secret** are injected at **build time** from a CI env var into a
  **gitignored generated constant** — the shipped Electron binary carries them, the repo does
  not. (The secret of an unverified desktop client isn't truly secret; this just keeps it out of
  git history.)
  - Add a build step, e.g. `electron/scripts/gen-oauth-config.mjs`, that reads
    `YT_BUNDLED_CLIENT_ID` / `YT_BUNDLED_CLIENT_SECRET` from the CI env and writes
    `electron/generated/oauth.mjs` (gitignored). Absent env → the file exports empty strings, so
    a local dev build simply has no bundled flow and only the override flow is offered.

### 1.2 Override flow (advanced)

- Operator pastes **their own** client ID + secret (today's setup fields). For: a Workspace user
  who wants a clean **Internal** consent (no warning, no cap), anyone past the 100-user cap on the
  bundled client, or anyone who won't trust a shared client.
- Headless **Docker** deployments use this flow via env/`.env` + the CLI script — unchanged.

---

## 2. In-app OAuth flow (Electron)

Trigger: "Connect YouTube" (first run) or "Reconnect YouTube" (reauth, §4).

1. The **main process** starts the loopback catcher on `http://localhost:53682/oauth2callback`
   (reuse `scripts/get-refresh-token.mjs` logic).
2. It builds the consent URL (`access_type=offline`, `prompt=consent`, scope
   `https://www.googleapis.com/auth/youtube`) using either the **bundled** client (default) or the
   **override** client (if the user supplied one) and opens it in the **system browser** via
   `shell.openExternal` — never an embedded webview (Google blocks embedded auth; and the user
   must see the real `accounts.google.com` URL).
3. On the callback, exchange `code` → tokens, persist `refresh_token` to `store.credentials`.
4. **Hot-rebuild** the YouTube client in-process (rebuild `ctx.yt` from the new creds) — **no
   server restart** (improves on today's restart-based setup).
5. If Google returns no `refresh_token` (previously granted), surface the existing guidance:
   revoke at `myaccount.google.com/permissions` and retry.

**Redirect URI** stays `http://localhost:53682/oauth2callback`. Registered once on the bundled
client; the exact string is documented for override users to register on their own client.

**Scope** stays the single `youtube` (read + write). No split.

**Constraint:** one app instance controls **one channel** at a time (matches the existing
single-target model). Multi-channel is explicitly out of scope for now.

---

## 3. Settings page (#7)

Promote setup from a first-run-only screen to a persistent **Settings** page reachable any time.

- **Connection section:**
  - Current status: connected / not connected, which flow is in use (bundled vs override), and
    masked identity where available (e.g. channel title, once fetched).
  - **"Connect YouTube"** (bundled, one-click) and an **"Use my own credentials"** disclosure that
    reveals the client ID/secret fields (override).
  - **"Reconnect YouTube"** to re-run the flow, and **"Disconnect"** to clear the stored refresh
    token.
- **App defaults section:** the existing `defaultCategory` / `defaultStreamBoundId`
  (`src/routes/settings.ts`) live here too — one place for all operator config.
- Secrets stay **write-only** over the wire: the API returns booleans (`hasClientId`, …), never
  the values — extend the existing `/api/setup/status` shape.
- Docker/headless: the page renders read-only guidance pointing at env/CLI, since it can't pop a
  browser.

---

## 4. Reauth (#5)

- When `cache.health === "auth_error"` (refresh token dead/revoked — see
  `src/youtube/client.ts` `isAuthError`), the dashboard shows an inline banner:
  **"YouTube connection lost — Reconnect"** wired to the §2 flow (Electron) / the settings page
  (Docker).
- On successful reconnect, health is re-evaluated on the next cache refresh (or force one), and
  the banner clears.
- Distinguish clearly from `degraded` (transient, retrying) — reauth is offered **only** for
  `auth_error`, never `degraded`. (Cross-refs the observability cluster's "explain degraded"
  item #6.)

---

## 5. Token storage at rest

Unchanged: **plaintext** `refresh_token` in `store.json` (PRD-01 §6 threat model — disk access
means already compromised). Electron `safeStorage` / OS keychain is noted as **future hardening**,
not in scope here.

---

## 6. Out of scope (this PRD)

- Multi-channel / multi-account within a single app instance.
- Google app **verification** (staying unverified + ≤100 users is accepted).
- Encrypt-at-rest for the refresh token (future hardening).
- Any change to the Docker/headless credential path beyond documenting it.

---

## User stories

1. As an Electron operator, I click **Connect YouTube**, approve in my real browser, and the app
   captures the refresh token to its DB — I never copy a token by hand.
2. As a Workspace operator who wants no warning screen or user cap, I switch to **Use my own
   credentials**, paste my client ID/secret, and connect through my own Internal consent screen.
3. As an operator whose token was revoked, I see a **Reconnect** banner on the dashboard and
   restore the connection in one flow without restarting the app.
4. As an operator, I open **Settings** at any time to see connection status, reconnect, disconnect,
   or edit app defaults — all in one place.
5. As a Docker operator, nothing changes: I configure credentials via env/`.env` or the CLI script,
   and the settings page shows read-only guidance.
