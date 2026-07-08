# YouTube Live Metadata Control middleware

Connects Companion to the middleware that drives YouTube Live metadata. It polls the cached
feedback endpoint (zero YouTube quota) and never calls YouTube directly.

## Why this module (vs. the Generic HTTP module)

Companion's bundled fonts render Arabic button text as boxes (tofu), and the Generic HTTP
module cannot put an image on a key. This module adds two **image feedbacks** that draw the
middleware's Arabic-rendered PNGs via `png64`, so an Arabic title/slug shows correctly.

## Configuration

- **Middleware base URL** — e.g. `http://localhost:8080` (same host as the dashboard).
- **Poll interval** — seconds between state polls (default 5).
- **Bearer token** — only needed if the action bus is protected.

## Variables

`display_label` (slug → preset id → "Custom"), `live_title`, `active_preset_id`, `is_live`,
`no_target`, `privacy`, `health`, `busy`, `api_enabled`, `quota_remaining`.

## Feedbacks (advanced, image)

- **Image: button label (slug)** — draws the slug/label PNG onto the button.
- **Image: full live title** — draws the full broadcast-title PNG onto the button.

Add one as the button's feedback; a two-state button can toggle slug ↔ title.

## Actions

Apply preset, Privacy toggle, Privacy set, Undo, Refresh — all hit the middleware's
`/api/action/*` bus.
