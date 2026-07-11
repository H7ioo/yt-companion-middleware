## Parent PRD

`issues/prd-03-auth.md`

## What to build

The in-app OAuth flow in the Electron main process (PRD-03 §2): "Connect YouTube" starts the
loopback catcher on `:53682`, opens the real consent URL in the **system browser**
(`shell.openExternal`), exchanges the code, writes the refresh token to `store.credentials`, and
**hot-rebuilds the YouTube client with no restart**. Uses the bundled client by default. Handles
the no-refresh-token-returned case with the existing revoke-and-retry guidance.

## Acceptance criteria

- [x] "Connect YouTube" opens consent in the system browser (no embedded webview).
- [x] Successful consent stores the refresh token in the DB — no manual token copy.
- [x] The YouTube client is rebuilt in-process; no server restart required.
- [x] Missing `refresh_token` surfaces the revoke-and-retry message.
- [x] Refresh token is never returned to any client endpoint.

## Implementation notes (done)

- `packages/server/src/youtube/oauthFlow.ts` — the loopback dance moved out of the CLI script:
  loopback catcher on `:53682`, `access_type=offline` + `prompt=consent` + single `youtube` scope,
  browser-open injected. Missing `refresh_token` → `OAUTH_NO_REFRESH_TOKEN` with revoke guidance.
  OAuth client injectable, so tests drive a real loopback with a fake Google (offline).
- `packages/server/src/youtube/connect.ts` — orchestration: operator's own stored client wins over
  the bundled one, run flow, persist refresh token to `store.credentials`, hot-apply.
- `server.ts` — the credentialed YouTube client is now a stable `Proxy` over a swappable
  `activeClient`; reconnect swaps it and forces a cache refresh, so the client is rebuilt
  **in-process with no restart** and Companion's connection stays up. First-run (no subsystem yet)
  falls back to the existing full boot. `startServer(options)` takes `openBrowser` + `bundledClient`.
- `routes/setup.ts` — `POST /api/setup/oauth/start` runs the flow (501 when the host can't open a
  browser, i.e. Docker); `GET /status` gains `hasBundledClient` + `canConnect`. Token never returned.
- `packages/desktop/main.mjs` — injects `shell.openExternal` + the build-time bundled client from
  `generated/oauth.mjs` into `startServer`.
- Web `SetupScreen` — one-click "Connect YouTube" hero when a bundled client ships; manual
  paste-your-own-credentials drops to a disclosure. Docker/no-bundle boots straight to the form.

Verified: full suite (137 tests) green, server + electron typecheck clean, web builds. Runtime smoke
confirmed the status shape, the consent URL (bundled id + loopback redirect) opening in the browser,
the live catcher on `:53682`, and a token-exchange failure surfacing as a 400.

### Follow-ups (separate issues)

- The **override** paste-flow already works through this connect path, but issue 013 owns its full
  UX (Internal-consent guidance, clearing/rotating a custom client).
- First-run still uses a full reboot to stand up the credentialed subsystem (nothing to preserve
  yet); a true zero-restart first boot would need routers to read `ctx` through an indirection —
  deferred, not required by the acceptance criteria.

## Blocked by

- Blocked by `issues/011-auth-bundled-client-injection.md`

## User stories addressed

- User story 1
