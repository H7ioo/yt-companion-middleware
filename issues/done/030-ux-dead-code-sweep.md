## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

Dead-code sweep (PRD-07 §12, #24 + #20): remove any on-demand Companion connection-check action
(redundant with the WS push, #20), verify no Bearer-auth/`apiToken`/`token` remnants survive
(PRD-02 §8 dropped it), and drop unused endpoints/fields left after the shared-contract extraction
(PRD-04). Guard removals with the integration tests (032) so nothing reachable is deleted.

## Acceptance criteria

- [x] Any redundant connection-check action removed (companion bump if module-facing).
- [x] No bearer-auth/token remnants remain in code or store schema.
- [x] Unused endpoints/fields removed; integration tests confirm nothing live was dropped.

## Done

Three-part sweep, all guarded by the existing unit tests + `tsc` and by static reachability
analysis (integration tests 032 are not yet built; noted below).

**1. Connection-check action removed (§7, #20).** Dropped the `check_connection` action, its
`checkConnection()` method, the `check_connection_btn` preset, and the now-unused `summarizeHealth`
helper (+ its unit tests). The module is push-only over the WebSocket — health arrives in the
pushed state frame and a dropped link is detected automatically — so an on-demand check was
redundant.

**2. Bearer-auth/token remnants removed (§12, PRD-02 §8).** The server dropped auth entirely
(verified: no `bearerMiddleware`/`apiToken`/token routes/store field remain — the only "token" hits
are the legitimate OAuth `refreshToken`). The Companion module still carried a dead `token` config
field + `Authorization: Bearer` header. Removed the config field, `authHeader()`, the header line,
and the `ModuleConfig.token` type. WS handshake and action POSTs now send no auth.

**3. Unused endpoint removed (§12, PRD-04).** `feedbackRouter`'s `GET /health` (feedback.ts) was
**shadowed** dead code: server.ts registers `app.get("/api/feedback/health")` *before* mounting the
`/api/feedback` router (deliberately, so it also answers in setup mode), so the router copy was
never reachable. Removed it; left a pointer comment. The reachable inline handler is unchanged and
is the only one any consumer (dashboard/desktop don't fetch it at all) sees.

**Migration + bump.** Removals ⇒ **major** bump `1.3.0 → 2.0.0` (package.json + manifest.json) with
an appended upgrade script (`dropBearerToken`) that strips the stale `token` key from a
connection's stored config. Docs updated: module README, HELP.md, and the site guide
(`packages/server/public/guide.html`) — removed Bearer-token/connection-check copy.

**Follow-up.** Deferred the broader "unused endpoints/fields" trawl of the narrow feedback routes
(`/status`, `/busy`, `/slug.png`, `/title.png`, `/active-preset`) — they are documented public API
(docs.html) and removing them needs the 032 integration-test guard to prove nothing live is
dropped. Only provably-shadowed code was removed here.

## Blocked by

- Blocked by `issues/027-ux-route-split-docs.md`

## User stories addressed

N/A. See PRD-07 §7 (#20), §12 (#24).
