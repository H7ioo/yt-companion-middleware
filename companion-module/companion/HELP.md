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
3. Set **Middleware base URL** to that host, and paste the **Device token** if the deployment
   issues them. Save — the status pill goes **Connecting → OK**.
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
  privacy toggle, undo, refresh, and the API kill-switch toggle.

Every dropped button stays fully editable afterwards.

## Configuration

- **Middleware base URL** — e.g. `http://localhost:8080` (same host as the dashboard). HTTPS is
  fine; the module derives `wss://` automatically.
- **Device token** — the credential a hosted deployment issues for this machine. An admin creates
  it under **Settings → Machines** on the dashboard, names it, and copies it **once**; paste it
  here. It is sent on both the HTTP actions and the WebSocket handshake, and it is revocable on
  its own without touching anyone else's access.

Leave the token blank for a local install with no accounts — nothing checks it there. On a hosted
server with accounts, fill it in: the **grace period** covers only the actions and the live socket,
so a blank or wrong token connects and fires actions but has every list route refused — the preset,
category and stream dropdowns come up empty and the connection reads **Authentication failure**,
with the reason in `last_error`. Every tokenless connection is also recorded and named in a
standing dashboard warning, and that window closes on evidence.

## Variables

`display_label` (slug → preset id → "Custom"), `live_title`, `active_preset_id`,
`active_preset_title`, `is_live`, `no_target`, `privacy`, `health` (`ok`/`degraded`/`offline`/`auth_error`), `health_message`, `busy`,
`api_enabled`, `quota_used`, `quota_limit`, `quota_remaining`, `undo_label`, `last_error`, `dashboard_url`,
`link`, `link_up`.

`link` is the state socket: `connected`, `connecting` or `disconnected`. Every other variable is a
reading the server pushed — while `link` is not `connected`, they are all as old as the outage and
a key press goes nowhere. See **Server unreachable** below.

`last_error` holds the code + message of the most recent **failed** action (e.g.
`INVALID_PRESET: no such preset`, `MISSING_TEMPLATE_VARS: …`). By default action errors surface
only in Companion's **log panel**; bind `last_error` to a button's text to see the latest failure
on a key for on-stream debugging. It starts blank and is never cleared by a state update — it only
changes when another action fails, so the last failure stays visible.

## Feedbacks

- **Image: button label (slug)** — draws the slug/label PNG onto the button.
- **Image: full live title** — draws the full broadcast-title PNG onto the button.
  Add one as the button's feedback; a two-state button can toggle slug ↔ title.
- **On air / Busy / API disabled / Health state is… / Active preset is…** — boolean feedbacks
  that recolor a key. *Active preset is…* highlights the key whose preset is currently applied.
- **Server unreachable (no live link)** — magenta, and the one to add to any key you would
  otherwise trust. It fires whenever the module is not holding the state socket. This is not the
  same as `offline` health: `offline` is the *server* telling you it cannot reach YouTube, which
  means the server is still talking to you. This one means nothing is talking to you at all —
  every reading on the deck is stale and every press lands nowhere. The **Server link**,
  **On-air indicator**, **Busy indicator** and both image presets already carry it.
- **Health color (auto)** — recolors a key to the current middleware health, no config:

  | health | meaning | key color |
  | --- | --- | --- |
  | `ok` | Healthy. | Green |
  | `degraded` | A transient failure, still retrying. | Yellow |
  | `offline` | Network unreachable (firewall / DNS / no internet) — not an auth problem. | Grey |
  | `auth_error` | Refresh token dead — needs manual reauth. | Red |

## Actions

Apply preset (dropdown + optional template-vars JSON), Update live metadata (title required),
Privacy toggle, Privacy set, Undo, Refresh from YouTube, Refresh lists — all hit the middleware's
`/api/action/*` bus (Refresh lists re-fetches the preset/category/stream dropdowns).

**Request fill (popup on dashboard / phone push)** — for a preset the operator must type values
into. A key cannot prompt for input, so this asks the middleware to surface the fill page: any
open dashboard instantly pops the fill dialog for the chosen preset, and if a **ntfy topic** is
configured in the dashboard (*Phone push* panel) the operator's phone also gets a tap-to-open
notification carrying the `/fill` deep link. Unclaimed requests expire after 60 s.

There is no on-demand connection-check action: the module holds a live WebSocket, so health arrives
in the pushed state frame (the `health` variable / *Health color* feedback) and a dropped link is
detected automatically — the status pill and `health` reflect it without a button press.

**API master switch (kill switch): set / toggle** — turns the middleware's master switch on/off
(`PUT /api/dashboard/service`). While off it makes no YouTube calls and rejects actions, so an
idle service stops burning quota. Pair the toggle with the *API disabled* feedback.

## Template vars & opening the dashboard

Companion has **no built-in "Open URL" action** — nothing on a key can open a browser. To fill a
template-var preset from a key, use this module's **Request fill** action (above): the fill page
reaches you through the open dashboard or an ntfy phone notification. To just look at the
dashboard, open `$(ytmeta:dashboard_url)` from a bookmark on any device on the LAN, or navigate to
`$(ytmeta:dashboard_url)/fill?preset=<id>` directly in a browser.
