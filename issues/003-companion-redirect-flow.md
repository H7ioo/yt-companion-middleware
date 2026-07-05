# 003 — Companion redirect (deep-link) flow

## Parent PRD

`issues/prd.md`

## What to build

The browser round-trip that lets a Bitfocus Companion button — which cannot show a popup —
open the fill page, collect variable values, fire the action, and bounce back to Companion
(PRD §6). Add an SPA fill route `GET /fill?preset=<id>&redirect=<url>` that preselects the
given preset and opens the fill popup from slice 002. On successful submit the page
redirects to the `redirect` URL supplied by Companion; on failure it stays and shows the
error. A preset with no variables opened with a redirect fires and bounces immediately
without a popup. The `redirect` target accepts any `http(s)` URL (no allowlist, LAN-trust).

## Acceptance criteria

- [ ] `GET /fill?preset=<id>&redirect=<url>` loads the SPA with the named preset
      preselected and its fill popup open.
- [ ] Submitting fires `POST /api/dashboard/action/preset` with the collected `vars`.
- [ ] On success the browser navigates to the `redirect` URL; on failure it stays on the
      page and shows the error.
- [ ] A variable-less preset opened via `/fill` with a `redirect` fires and redirects
      immediately, with no popup.
- [ ] Any `http(s)` `redirect` URL is accepted (no allowlist).
- [ ] Missing/unknown `preset` shows a clear message rather than a blank or broken page.

## Blocked by

- Blocked by `issues/002-ui-fill-popup.md`

## User stories addressed

- User story 7
