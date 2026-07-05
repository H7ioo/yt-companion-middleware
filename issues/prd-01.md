# Product Requirements Document (PRD)

## YouTube Live Metadata Control Middleware — v2

---

### 1. Overview & Objective

A lightweight, Docker-hosted local web application that acts as an API gateway between Bitfocus Companion (Stream Deck) and the YouTube Live Streaming API. It abstracts YouTube's multi-step metadata constraints into single-endpoint actions and provides cached, low-cost state feedback back to Companion.

This is an internal/personal tool — design choices favor simplicity and low quota usage over enterprise-grade robustness.

---

### 2. Core Operational Logic

* **State A: Idle (No Active Stream).** Metadata updates target the channel's default **persistent broadcast container**.
* **State B: Live (Active Stream Detected).** Metadata updates target the **currently active broadcast**.

If no persistent container exists (e.g. brand-new channel), the app fails with a clear `NO_TARGET_FOUND` error rather than attempting to create one. This is a low-priority edge case for this use case.

---

### 3. Data Model

#### 3.1 App-Level Default Settings

Stored globally, always used as the baseline for every update:

```json
{
  "defaultCategory": "20",
  "defaultStreamBoundId": "abcd-1234-streamkey"
}
```

* **Category** and **stream binding (stream key)** are first-class, independently controllable fields — not just passed through from YouTube's current state.
* These act as the fallback whenever a preset or ad-hoc update doesn't explicitly override them.

#### 3.2 Preset Schema

```json
{
  "id": "gaming_main",
  "title": "Late Night Gaming Live!",
  "description": "Custom description text",
  "privacyStatus": "public",
  "category": null,
  "streamBoundId": null
}
```

* `title`, `description`, `privacyStatus` — always defined per preset.
* `category`, `streamBoundId` — **optional overrides**. If `null`/omitted, the app-level default setting is used instead. If set, the preset value wins.
* All other YouTube broadcast fields not covered above (thumbnail, game ID, etc.) are **never stored or set by this app** — they are always inherited unchanged from the live GET response (see §6, Read-Modify-Write Rule).

#### 3.3 Resolution Order (on every trigger)

1. GET current broadcast object from YouTube.
2. Determine `category` = preset override → else app default → else leave untouched if neither is set.
3. Determine `streamBoundId` = preset override → else app default → else leave untouched if neither is set.
4. Overlay `title` / `description` / `privacyStatus` from preset or ad-hoc payload.
5. All other fields (thumbnail, game ID, etc.) copied as-is from the GET.
6. PUT full merged object back.

---

### 4. Preset Management — Full CRUD

* **Create** — Title, Description, Privacy Status required; Category and Stream Binding optional (inherit default if blank).
* **Read** — List all presets with their mapping target ID for copy-paste into Companion.
* **Update** — Edit any field of an existing preset.
* **Delete** — Remove a preset. (No cascading concerns — Companion configs referencing a deleted `presetId` will simply receive `INVALID_PRESET` on next trigger.)

---

### 5. API & Integration Specifications

#### 5.1 Network Architecture

* Runs in Docker on local/private network (`http://<APP_IP>:<PORT>`).
* OAuth 2.0 refresh token stored server-side only, in `.env` (or an encrypted `.env`-backed value) — **never exposed to Companion or any client-facing endpoint.**
* No user-facing login system needed; this is a single-operator tool.

#### 5.2 Local API Authentication

* Threat model: LAN-trust, not internet-facing. The concern is an unrelated device on the same network accidentally or casually hitting the endpoint — not a determined attacker (if someone has remote access to the host machine, the app is already compromised regardless of API auth).
* All action/feedback endpoints (except a minimal `/health` check if desired) require:
  ```
  Authorization: Bearer <token>
  ```
* Token is generated once, stored hashed/encrypted in the app's local store.
* Web dashboard includes a **"Regenerate Token"** button — invalidates the old token immediately; operator updates the single header value in Companion's connection config.
* Companion's generic HTTP module supports custom headers, so this requires no special handling on the Companion side.

#### 5.3 Action Endpoints (Companion → App)

**`POST /api/action/preset`**
```json
{ "presetId": "gaming_main" }
```
Behavior:
1. Check `busy` flag (see §5.5). If busy and a request is already queued, respond `BUSY_TRY_AGAIN` immediately.
2. Set `busy = true`.
3. Resolve target (active broadcast vs. persistent container).
4. Run GET → merge (per §3.3) → PUT.
5. Update the internal status cache (§5.4) with the new state.
6. Set `busy = false`; process queued request if one exists.

**`POST /api/action/update`** — ad-hoc override, bypasses presets.
```json
{
  "title": "Custom Input Title",
  "description": "Custom description text",
  "privacyStatus": "public",
  "category": "20",
  "streamBoundId": "abcd-1234-streamkey"
}
```
All fields except `title` optional; omitted fields fall back to app defaults per §3.3. Same busy/queue/cache behavior as above.

**`POST /api/action/refresh`**
Forces an immediate live GET from YouTube and updates the status cache, bypassing the cache TTL. Intended to be bound to a manual "Refresh" button on the Stream Deck for on-demand confirmation right after a change is expected (e.g. ended stream manually from YouTube Studio).

#### 5.4 Feedback & State Endpoints (Companion ← App)

All feedback endpoints are served from an **in-app cache**, never a live YouTube call — this keeps Companion's polling free of YouTube quota cost.

* **Cache population:** updated automatically after every successful action, plus a background refresh every 60s to catch out-of-band changes (e.g. stream ended manually via YouTube Studio).
* **Companion polling interval:** every 5 seconds while the buttons page is open, hitting only cached endpoints.

**`GET /api/feedback/active-preset`**
```json
{ "activePresetId": "gaming_main" }
```

**`GET /api/feedback/status`**
```json
{
  "title": "Late Night Gaming Live!",
  "privacyStatus": "public",
  "isLive": true
}
```

**`GET /api/feedback/busy`**
```json
{ "busy": true }
```
Drives a "processing" button color/blink in Companion while a request is in flight. Single global flag is sufficient — this app only ever manages one broadcast target at a time.

**`GET /api/feedback/health`**
```json
{
  "status": "ok",
  "authenticated": true,
  "message": null
}
```
`status` values:
| Value | Meaning | Suggested button color |
|---|---|---|
| `ok` | Everything healthy | Green |
| `degraded` | Transient failure (e.g. 1-2 consecutive refresh failures), still retrying | Yellow |
| `auth_error` | Refresh token dead/revoked — not recoverable by retry, needs manual reauth via dashboard | Red |

To avoid button flicker from a single transient network blip, the app tracks **consecutive** refresh failures and only escalates `ok → degraded → auth_error` after repeated failures (e.g. 3 in a row), not on the first failure.

#### 5.5 Concurrency Handling

* Single global `busy` flag; no parallel action processing (this app manages one broadcast target, so this is sufficient rather than needing per-target locking).
* If a new action request arrives while `busy = true`:
  * If no request is already queued → queue it (max depth 1), execute immediately after current one finishes.
  * If a request is already queued → reject the new one with `BUSY_TRY_AGAIN`.
* This models realistic operator behavior (a click plus one "catch-up" click) without needing a full request queue.

---

### 6. Technical Implementation Safeguards

> **Critical Data Safeguard (Read-Modify-Write Rule):**
> The application is strictly prohibited from executing blind metadata overwrites via `liveBroadcasts.update`. On every trigger, the app must sequentially: GET the current object, apply the field resolution order in §3.3 (category/stream binding from preset-or-default, title/description/privacy from payload, everything else — thumbnail, game ID, etc. — passed through unchanged), then PUT the full merged payload back. This keeps all un-edited elements intact mid-stream.

**Multiple active broadcasts:** In rare cases (e.g. app missed a "complete broadcast" transition, or a simulcast setup), `liveBroadcasts.list(broadcastStatus="active")` could return more than one result. The app resolves this by selecting the broadcast with the most recent `actualStartTime` and logging a warning. No UI is built around this edge case.

**Storage:** JSON file on disk (mounted as a Docker volume), covering presets, app-level default settings, hashed API token, and cached status/health state. Writes are atomic (write to temp file, then rename) to avoid corruption on crash mid-write. SQLite may be considered later if the data model grows, but JSON is sufficient to start.

---

### 7. Error Contract

All action endpoints **always return HTTP 200**, with success/failure encoded in the body. This avoids relying on Companion's HTTP module correctly branching on status codes, which isn't consistently reliable across Companion HTTP configurations — keeping everything in the body is the more portable choice.

```json
{
  "success": false,
  "error": {
    "code": "YOUTUBE_QUOTA_EXCEEDED",
    "message": "YouTube API quota exceeded, try again later"
  }
}
```

Initial error codes:

| Code | Meaning |
|---|---|
| `NO_TARGET_FOUND` | No active broadcast and no persistent container found |
| `YOUTUBE_AUTH_ERROR` | YouTube API rejected the request due to token issues |
| `YOUTUBE_QUOTA_EXCEEDED` | API quota exhausted |
| `INVALID_PRESET` | `presetId` not found |
| `BUSY_TRY_AGAIN` | A request is already in flight and the queue slot is full |

Companion can bind `error.message` to a variable and briefly display it on the button text for on-stream debugging.

---

### 8. System & Web Interface Features

#### 8.1 Preset Management Panel
* Grid of configured presets with full Create/Read/Update/Delete.
* Each preset shows: Title, Description, Privacy Status, and (if overridden) Category / Stream Binding — otherwise shown as "inherits default."
* Each preset displays its mapping target ID for copy-paste into Companion JSON payload configs.

#### 8.2 App-Level Default Settings Panel
* Set/edit `defaultCategory` and `defaultStreamBoundId`, used as fallback whenever a preset or ad-hoc update doesn't override them.

#### 8.3 Ad-Hoc Update Modal
* Single-page form to push modifications manually when not using a preset (title, description, privacy, optional category/stream binding overrides).
* Status badge showing whether changes will hit the inactive container or an active live stream.

#### 8.4 API Token Management
* Displays current token status (masked).
* "Regenerate Token" button, invalidating the previous token immediately.

---

### 9. Open Items / Deliberately Out of Scope for v2

* Full request queue beyond depth 1 — not needed given expected usage pattern.
* Auto-creation of a persistent broadcast container if missing — internal tool, not a priority.
* SQLite migration — revisit only if JSON storage becomes a bottleneck.
