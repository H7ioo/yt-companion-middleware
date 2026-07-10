# PRD — Observability: Logging, Failure Categorization & the `offline` State

Covers grill-me items **#3** (dashboard logging), **#4** (firewall/connection-blocked detection
+ guidance), **#6** (explain "degraded"). Also fixes a latent health-escalation bug.

Builds on `src/core/health.ts`, `src/core/stateCache.ts`, `src/youtube/client.ts`
(`mapYouTubeError`), `src/routes/feedback.ts`, and the Companion feedback contract.

---

## 0. The bug this fixes

`src/core/health.ts` `onFailure` escalates **any** repeated non-auth failure to `auth_error` once
it hits `threshold`. So a **firewall blocking outbound 443** produces 3 failed refreshes → the
dashboard shows **"auth error — reconnect YouTube"**, sending the operator to re-auth when the real
fault is the network. And `mapYouTubeError` only classifies HTTP 401/403/quota — a raw
`ECONNREFUSED` / `ETIMEDOUT` / `ENOTFOUND` / `EAI_AGAIN` falls through to a generic error.

The fix (below) makes the app **distinguish network failures from auth failures** and stops
mislabeling firewalls as auth problems.

---

## 1. New `offline` health state (chosen design)

Health becomes a **4-state** model. `degraded` stays for early/unclassified transients; a distinct
`offline` captures sustained network-level failure.

| State | Meaning | Companion color |
|---|---|---|
| `ok` | Healthy | Green |
| `degraded` | 1–2 transient failures, retrying, cause not yet classified | Yellow |
| `offline` | Repeated **network-level** failures (firewall / no internet / DNS) — not auth | Orange/Grey |
| `auth_error` | 401/403 auth reasons — refresh token dead/revoked, needs reauth | Red |

- **Quota stays data, not a health state** — `quotaRemaining` already rides on `/health` and
  `/active-preset`; a quota-exhausted condition surfaces as a message/log, not a health color.
- Escalation logic in `health.ts`:
  - auth failure → `auth_error` immediately (unchanged).
  - network failure (new classification) → `degraded` then `offline` after `threshold` consecutive
    network failures. **Never `auth_error`.** (Fixes §0.)
  - success → `ok`.

### 1.1 Failure classification

Extend `mapYouTubeError` (and/or add a classifier) to detect Node network error codes
(`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`, `ECONNRESET`) → a `NETWORK_ERROR`
`AppError`, distinct from `YOUTUBE_AUTH_ERROR` / `YOUTUBE_QUOTA_EXCEEDED`. `stateCache` feeds the
classification into `onFailure` so the right state is chosen.

### 1.2 Companion-module ripple (hard rule — AGENTS.md)

Adding `offline` to the feedback contract changes companion-facing behavior:

- `npm run companion:bump minor` (new feedback value) in the **same PR**.
- Update the health-color feedback mapping in `companion-module/main.js` / `src/transform.js`
  (add the `offline` case; keep helpers unit-tested first per AGENTS.md).
- Add an upgrade script entry only if any existing value is renamed/removed (a pure addition may
  not need one — follow VERSIONING.md).
- Update the color table in `public/guide.html` and `companion-module/companion/HELP.md`.
- **Wording parity (#10):** whatever label `offline` gets ("Offline" / "Connection blocked") must
  be identical on the dashboard, the guide, and the Companion feedback — one canonical string.

---

## 2. Firewall guidance (#4)

When health is `offline`, the dashboard shows an actionable panel (not just a red lamp):

- Plain explanation: "The app can't reach YouTube. This is usually a firewall or network problem,
  not a login problem."
- Concrete fix steps for **Windows and Linux** (matches the OS-tailored docs goal, #25):
  - Allow the app / `node` outbound **HTTPS (443)** to `*.googleapis.com`.
  - Windows Defender Firewall → Allow an app; Linux `ufw`/`firewalld` allow-outbound note.
  - "Test again" button that forces a cache refresh (`/api/action/refresh`) and re-evaluates.
- Distinguish from `auth_error` guidance (which offers **Reconnect**, per PRD-03 §4). `offline`
  never offers reauth.

---

## 3. Dashboard logging (#3) — in-memory ring buffer

A lightweight event log for live debugging, surfaced on the dashboard.

- **Store:** in-memory ring buffer (e.g. last 200 events). Cleared on restart — acceptable for a
  live-debugging aid on a LAN tool. (File persistence deliberately deferred, §5.)
- **Event shape:** `{ ts, level: 'info'|'warn'|'error', category: 'auth'|'network'|'quota'|'action'|'system', code, message }`.
- **Producers:** refresh failures (with category from §1.1), action failures, auth errors, quota
  events, service enable/disable, reconnect attempts. A small `logger` module the cache / runner /
  routes push into (replacing the current total absence of logging).
- **Endpoint:** `GET /api/dashboard/logs` (unauthenticated, LAN-trust, dashboard-only) returns the
  buffer newest-first. Optionally streamed over the existing SSE/WebSocket change channel so the
  panel updates live.
- **Dashboard "Activity" panel:** newest-first list, color-coded by level, filterable by category.
  Auth/network entries link to the relevant guidance (§2 / reconnect).

---

## 4. Explain "degraded" (#6)

- The dashboard health indicator gains an inline explainer (tooltip/expandable) that names the
  current state **and its reason**, drawn from the health state + latest categorized failure:
  - `ok` — "Connected and healthy."
  - `degraded` — "A recent check failed; retrying. Usually a brief network blip."
  - `offline` — "Can't reach YouTube — likely a firewall/network issue." → §2 panel.
  - `auth_error` — "YouTube rejected the login — reconnect needed." → PRD-03 reconnect.
- Copy is the **single canonical source** reused wherever these states appear (dashboard, guide),
  reinforcing #10.

---

## 5. Out of scope

- File/rotating-log persistence (in-memory only for now; revisit if post-mortem-after-restart
  becomes a real need).
- Structured log export / external log shipping.
- Treating quota exhaustion as a health color (stays data-only).

---

## 6. Deliverables

- 4-state health with network classification + the §0 bug fix (`health.ts`, `stateCache.ts`,
  `client.ts`).
- `offline` wired through `/api/feedback/*` and the companion-module (bump + color mapping + docs).
- `logger` ring buffer + `GET /api/dashboard/logs` + dashboard Activity panel.
- `offline` firewall-guidance panel (Windows + Linux) with a re-test button.
- "Degraded/offline/auth" explainer copy, single-sourced and shared with the guide.
