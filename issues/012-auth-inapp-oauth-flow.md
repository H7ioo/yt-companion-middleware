## Parent PRD

`issues/prd-03-auth.md`

## What to build

The in-app OAuth flow in the Electron main process (PRD-03 §2): "Connect YouTube" starts the
loopback catcher on `:53682`, opens the real consent URL in the **system browser**
(`shell.openExternal`), exchanges the code, writes the refresh token to `store.credentials`, and
**hot-rebuilds the YouTube client with no restart**. Uses the bundled client by default. Handles
the no-refresh-token-returned case with the existing revoke-and-retry guidance.

## Acceptance criteria

- [ ] "Connect YouTube" opens consent in the system browser (no embedded webview).
- [ ] Successful consent stores the refresh token in the DB — no manual token copy.
- [ ] The YouTube client is rebuilt in-process; no server restart required.
- [ ] Missing `refresh_token` surfaces the revoke-and-retry message.
- [ ] Refresh token is never returned to any client endpoint.

## Blocked by

- Blocked by `issues/011-auth-bundled-client-injection.md`

## User stories addressed

- User story 1
