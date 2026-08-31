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

---

## Done (2026-08-31)

All acceptance criteria met. Every box above is covered by a test that boots the real route table
or the real upgrade handler, not a hand-rolled copy of it.

**Device tokens** — `packages/server/src/auth/deviceTokens.ts`. 32 random bytes behind a `ytm_`
prefix; only the SHA-256 hash is stored, as for sessions and invites. Revoked records are kept
rather than deleted, because `lastUsedAt` on a revoked token is what answers "was this the one live
on the box we just cut off?".

**A token is never an admin.** There is deliberately no `role` field on one. `requireAdmin()`
refuses a device caller outright, so no future token can be minted into an admin — and
`requireSession()` now *accepts* one, which closes the gap issue 044 left behind: the five
`/api/dashboard/*` routes the module calls (presets, categories, streams, service, fill-request)
were reachable only by a cookie, so a correctly-configured module would still have gone dark.

**Both surfaces.** The HTTP guard and the WebSocket upgrade read the same `Authorization: Bearer`
header through one seam (`Auth.callerOfHeaders`) — the module speaks both, so checking one is
checking nothing. Revocation cuts the live socket (close code 4401) rather than waiting for a
reconnect that, on a Companion box, never comes.

**Grace mode** — `packages/server/src/auth/grace.ts`, with `enforcing` persisted in the store so
issue 049's flip and its rollback need no redeploy. Both directions are already exercised by a test.

**The exit condition is two counters.** `daysSinceTokenless` and `goLivesSinceTokenless`, both
reported always, `met` only when both hold. Go-lives are fed from the poll loop's existing
broadcast observation (`StateCache.setGoLiveHandler`), deduped by broadcast id so one show counts
once. Any tokenless connection zeroes both.

**Dashboard**: a Machines section in Settings (admin only) with the standing warning. The readout
renders as two gauges and a sentence naming the half still missing — never a single verdict, which
is the failure mode the issue is about. Called "Machines", not "Devices": `devices` already means
a person's signed-in browsers on that same screen.

### Notes for the next iteration

- **Write amplification was a real trap here.** Companion polls every few seconds and every store
  write rewrites the whole `store.json`. Both `recordTokenless` and device-token `lastUsedAt` are
  therefore written at 5-minute granularity — but `recordTokenless` flushes *immediately* whenever
  the verdict would move, so "met" can never be stale. Anything else hung off the Companion request
  path needs the same treatment.
- **A still-tokenless module cannot reach those five `/api/dashboard/*` routes**, because grace
  mode covers the Companion bases and the socket, not the dashboard prefix. This is not a
  regression — issue 044 already closed them — and issue 048 gives the module its token, which
  resolves it. Widening grace to the whole dashboard prefix was deliberately not done: it would
  open far more surface than the migration needs.
- Issue 049 needs to add the enforcement toggle to the Machines section. `Grace.setEnforcing` and
  `GET /api/dashboard/devices/grace` are both in place; only the control is missing, left out on
  purpose so a switch never ships ahead of the evidence discipline around it.
- The root `npm run typecheck` does not cover `packages/web` (server and companion only). The web
  package typechecks with `npx tsc --noEmit -p packages/web/tsconfig.json`. Worth its own issue.
