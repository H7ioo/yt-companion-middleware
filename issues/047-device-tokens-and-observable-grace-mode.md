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
- The exit condition is readable, and it is **two counters, not one** (settled in issue 042):
  **"no tokenless client has connected in 14 consecutive days, spanning at least one go-live"**. The
  days half alone is not evidence — a 14-day off-season satisfies it while the still-tokenless
  Companion machine sits powered down, and grace mode comes off just in time for the next show to go
  dark. So the readout carries both: *days since the last tokenless connection* **and** *go-lives
  since the last tokenless connection*, and it says "met" only when days ≥ 14 and go-lives ≥ 1.
  Go-lives are counted from the same broadcast transitions the server already sees, so a show that
  ran tokenless resets both counters.

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
- [ ] The exit condition is visible without reading logs, as both counters: days since the last
      tokenless connection (against the 14-day threshold) **and** go-lives since it.
- [ ] The readout reports "met" only when both halves hold; 14 quiet days with no go-live in them
      still reads as not met, and a tokenless connection resets both counters.

## Blocked by

- Blocked by `issues/045-roles-admin-and-user.md`

## User stories addressed

- User story 5
