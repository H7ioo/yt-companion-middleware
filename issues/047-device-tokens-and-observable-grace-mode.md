## Parent PRD

`issues/prd-15-hosted-auth-and-accounts.md`

## What to build

Credentials for machines, and the safety net that stops adding them from taking the Stream Deck
offline. PRD-15 §2 and §4.

**Device tokens.** Created in the dashboard by an admin, given a name ("companion machine"), copied
once, revocable individually. Checked on the HTTP header **and** on the WebSocket handshake — the
module uses both, so guarding one is guarding nothing.

**Machine tokens are never admin.** A token that lives in a config file on a shared machine must be
able to run the show and nothing else.

**Grace mode**, and the reason this slice exists. The module in the field cannot send a token yet
(that is issue 048), so `/api/action` and `/api/feedback` accept tokenless connections while grace
mode is on — but never silently:

- Every tokenless connection is recorded: when, from where, which client.
- The dashboard carries a standing warning naming what is still connecting the old way.
- The exit condition is readable: **"no tokenless client has connected in 14 consecutive days,
  spanning at least one go-live"** (settled in issue 042). Show days for a reason — the Companion
  machine may only be powered up on show night — so the readout shows *days since the last tokenless
  connection*, not just a list of offenders.

Without that, grace mode is authentication switched off with no signal for when it is safe to turn
on, and "temporary" becomes permanent.

## Acceptance criteria

- [ ] An admin can create, name and revoke a device token; a user cannot.
- [ ] The token is shown once at creation and never retrievable afterwards.
- [ ] A valid token authenticates both an HTTP request and a WebSocket handshake.
- [ ] A device token is refused on every admin-only route, under any construction.
- [ ] Revoking a token drops its next request and its live socket.
- [ ] While grace mode is on, a tokenless Companion connection is accepted **and recorded**.
- [ ] The dashboard shows the standing warning and names the offending client.
- [ ] The exit condition (days since the last tokenless connection, against the 14-day threshold)
      is visible without reading logs.

## Blocked by

- Blocked by `issues/045-roles-admin-and-user.md`

## User stories addressed

- User story 5
