# YouTube Live Metadata Control Middleware

API gateway between Bitfocus Companion (Stream Deck) and the YouTube Live Streaming API.
Collapses YouTube's multi-step metadata constraints into single-endpoint actions and
serves cached state back to Companion so polling never costs YouTube quota.

See [youtube-live-metadata-middleware-prd.md](youtube-live-metadata-middleware-prd.md)
for the full spec.

## Stack

- **Backend** — Node.js + Express + TypeScript ([src/](src/))
- **Dashboard** — React + Vite, served as static files by the backend ([web/](web/))
- **Storage** — atomic JSON file on a Docker volume ([src/storage/](src/storage/))

## Configuration

Copy [.env.example](.env.example) to `.env` and fill in:

| Var | Purpose |
|---|---|
| `YT_CLIENT_ID` / `YT_CLIENT_SECRET` | OAuth client from Google Cloud Console |
| `YT_REFRESH_TOKEN` | Long-lived refresh token (obtained once, see below) |
| `PORT` | HTTP port (default 8080) |
| `DATA_DIR` | JSON store location (default `./data`) |
| `YT_QUOTA_LIMIT` | Daily API quota budget in cost-weighted units (default 10000) |

The refresh token is obtained once via a standard OAuth consent flow with the
`https://www.googleapis.com/auth/youtube` scope, then stored server-side only — it is
never exposed to Companion or any client (PRD §5.1).

## Run

### Docker (recommended)

```bash
docker compose up --build
```

Dashboard + API at `http://<host>:8080`. Data persists in `./data`.

An interactive API console lives at `http://<host>:8080/docs` — it documents every route
and can fire test requests against the running server (paste your Bearer token to reach the
action and feedback buses; the action bus falls back to its unauthenticated dashboard mirror
when the token is blank).

### Local dev

```bash
npm install
npm --prefix web install
npm run dev          # backend on :8080
npm --prefix web run dev   # dashboard on :5173 (proxies /api to :8080)
```

## Companion setup

1. Open the dashboard, create presets, set app-level defaults.
2. Generate an API token (API token panel) and copy it.
3. In Companion's generic HTTP connection, add header
   `Authorization: Bearer <token>` and point actions at:
   - `POST /api/action/preset` — body `{ "presetId": "<id>" }` (copy from the preset card)
   - `POST /api/action/update` — ad-hoc override
   - `POST /api/action/privacy` — set `{ "status": "public" }` or flip with `{ "mode": "toggle" }`
   - `POST /api/action/undo` — revert the last metadata change
   - `POST /api/action/refresh` — force a cache refresh
   - `GET /api/feedback/{status,busy,active-preset,health}` — cached feedback (poll every 5s)

All action endpoints always return HTTP 200 with `success`/`error` in the body (PRD §7).

## Beyond the PRD

Workflow extras added on top of the v2 spec:

- **Privacy toggle** — one-button `POST /api/action/privacy` flips private↔public (or sets an
  explicit value) without re-applying the default category/stream.
- **Undo** — every change snapshots the prior title/description/privacy/stream binding;
  `POST /api/action/undo` restores it. Surfaced as an **Undo** button on the dashboard.
- **Quota budget** — cost-weighted daily YouTube quota is tracked (reads=1, writes=50, PT
  reset) and returned on `/api/feedback/health` (`quotaUsed`/`quotaLimit`/`quotaRemaining`)
  plus a color bar on the dashboard.
- **Push instead of poll** — SSE stream at `/api/feedback/stream` (authed) and
  `/api/dashboard/stream`; the dashboard uses it and falls back to polling. Configure an
  outbound **state webhook** in the dashboard to `POST { event, state }` on every change.
- **Bulk preset import/export** — Export/Import buttons back up or clone presets as JSON
  (`GET /api/dashboard/presets/export`, `POST /api/dashboard/presets/import`).
- **Stream-binding validation** — preset and default stream fields warn when the bound
  stream id no longer exists on the channel (`GET /api/dashboard/streams`).
- **Arabic-safe button text** — Companion's bundled fonts render Arabic titles as boxes
  (tofu). Each preset has a short **button label** (slug); feedback exposes `displayLabel`
  (slug → preset id → `"Custom"`) as Latin-safe text, plus `slugPng`/`titlePng` — the label
  and full title pre-rendered to base64 PNGs with an Arabic-capable font (shaped + joined),
  also served raw at `GET /api/feedback/{slug,title}.png`. Bind the PNG as a button image and
  toggle between the two. PNGs are cached per text and pushed over SSE/WebSocket like the rest
  of the state.

## Test

```bash
npm test
```
