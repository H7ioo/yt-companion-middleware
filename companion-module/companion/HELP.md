# YouTube Live Metadata Control middleware

Connects Companion to the middleware that drives YouTube Live metadata. It holds a **live
WebSocket** to the cached feedback endpoint (zero YouTube quota) and never calls YouTube directly.

## Why this module (vs. the Generic HTTP module)

Companion's bundled fonts render Arabic button text as boxes (tofu), and the Generic HTTP
module cannot put an image on a key. This module adds two **image feedbacks** that draw the
middleware's Arabic-rendered PNGs via `png64`, so an Arabic title/slug shows correctly.

## Transport

The module keeps a persistent WebSocket to `/api/feedback/ws`. The server pushes a `state` frame
on connect and on every change — **instant, no polling** — and the module auto-reconnects if the
link drops. Actions are HTTP `POST`s to `/api/action/*`; after each one the server pushes a fresh
state, so there is nothing to poll.

## Quick setup

1. Make sure the middleware is running and reachable (its dashboard opens at
   `http://<APP_IP>:8080`).
2. Install this module — either **Modules → Import module package** with the
   `yt-companion-middleware-<version>.tgz` built by `npm run companion:package` (from the repo
   root), or via the **Developer
   modules path** (see the module README). Then **Connections → Add connection**, search
   **yt-companion-middleware**, add it.
3. Set **Middleware base URL** to that host. Leave **Bearer token** blank unless the action bus
   is protected. Save — the status pill goes **Connecting → OK**.
4. Confirm it works: set any key's text to `$(ytmeta:display_label)`.
5. On a key, add a **feedback** (image or boolean) and/or an **action** from the tables below.

After editing presets in the dashboard, run the **Refresh preset/category/stream lists** action
once so the dropdowns pick up the change.

## Presets (drag-drop buttons)

Open the **Presets** tab for ready-made buttons — the quickest way to build a page:

- **Apply preset** category — one button *per middleware preset*, already labelled with its slug,
  already wired to the apply action, and already carrying the *Active preset is…* highlight. Drag
  one onto a key and it applies + self-labels + lights up when active, no config. After editing
  presets in the dashboard, run **Refresh preset/category/stream lists** so new ones appear.
- **State & controls** category — Arabic-safe title/label images, on-air & busy indicators,
  privacy toggle, undo, refresh, connection check, and the API kill-switch toggle.

Every dropped button stays fully editable afterwards.

## Configuration

- **Middleware base URL** — e.g. `http://localhost:8080` (same host as the dashboard). HTTPS is
  fine; the module derives `wss://` automatically.
- **Bearer token** — only needed if the action bus is protected.

## Variables

`display_label` (slug → preset id → "Custom"), `live_title`, `active_preset_id`,
`active_preset_title`, `is_live`, `no_target`, `privacy`, `health`, `health_message`, `busy`,
`api_enabled`, `quota_used`, `quota_limit`, `quota_remaining`, `undo_label`, `dashboard_url`.

## Feedbacks

- **Image: button label (slug)** — draws the slug/label PNG onto the button.
- **Image: full live title** — draws the full broadcast-title PNG onto the button.
  Add one as the button's feedback; a two-state button can toggle slug ↔ title.
- **On air / Busy / API disabled / Health state is… / Active preset is…** — boolean feedbacks
  that recolor a key. *Active preset is…* highlights the key whose preset is currently applied.

## Actions

Apply preset (dropdown + optional template-vars JSON), Update live metadata (title required),
Privacy toggle, Privacy set, Undo, Refresh cache, Refresh lists — all hit the middleware's
`/api/action/*` bus (Refresh lists re-fetches the preset/category/stream dropdowns).

**Check middleware connection (YouTube status)** — pings `/api/feedback/health` on demand, logs
reachability + YouTube auth/quota, and updates the connection status pill. Bind it to a key to
verify the link (and YouTube auth behind it) any time.

**API master switch (kill switch): set / toggle** — turns the middleware's master switch on/off
(`PUT /api/dashboard/service`). While off it makes no YouTube calls and rejects actions, so an
idle service stops burning quota. Pair the toggle with the *API disabled* feedback.

## Template vars & opening the dashboard

Use Companion's built-in **Open URL** action, not this module:

- Open the dashboard: **Open URL** → `$(ytmeta:dashboard_url)`.
- Fill a template-var preset: **Open URL** →
  `$(ytmeta:dashboard_url)/fill?preset=<id>&redirect=<back>`.
