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

- [x] `GET /fill?preset=<id>&redirect=<url>` loads the SPA with the named preset
      preselected and its fill popup open.
- [x] Submitting fires `POST /api/dashboard/action/preset` with the collected `vars`.
- [x] On success the browser navigates to the `redirect` URL; on failure it stays on the
      page and shows the error.
- [x] A variable-less preset opened via `/fill` with a `redirect` fires and redirects
      immediately, with no popup.
- [x] Any `http(s)` `redirect` URL is accepted (no allowlist).
- [x] Missing/unknown `preset` shows a clear message rather than a blank or broken page.

## Done

The Companion round-trip is client-side: the server's existing SPA catch-all already
serves `/fill`, so no backend change was needed. `web/src/lib/fillRoute.ts` (unit-tested,
8 cases) parses `?preset=&redirect=` and drops any non-`http(s)` redirect. `main.tsx`
branches on it router-free — a matched `/fill` renders the new `web/src/FillPage.tsx`,
everything else stays on `App`.

`FillPage` loads presets, finds the id, and: reuses `PresetFillModal` for variabled
presets (wrapping `fire` so a successful apply bounces to `redirect`); auto-fires a
variable-less preset once and redirects immediately with no popup; and renders a
control-surface "console" card with a tally lamp for the loading / firing / applied /
error / unknown-preset states. Failures keep the user on the page with the error.

Verified: 87 unit tests, both typechecks, `build:web`, and a served-bundle smoke check
(`/fill?preset=…` returns the SPA with the built bundle) all pass. Exercised live against
the real server (creds in `.env`): firing the variable-less preset action that `/fill`
fires flipped the target from "Testing Hello world"/private to the preset title/public on
YouTube (`success:true`), and undo reverted it cleanly — confirming the apply the redirect
flow depends on works end-to-end.

## Blocked by

- Blocked by `issues/002-ui-fill-popup.md`

## User stories addressed

- User story 7
