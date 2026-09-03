## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Know whether this app is driving or riding along, and say so. PRD-16 §6.

YouTube blocks broadcast creation for ineligible channels — notably under 50 subscribers.
**Detect it, do not guess it.** `insert` fails with a recognisable refusal
(`insufficientLivePermissions`, `livePermissionBlocked`, `liveStreamingNotEnabled`), which is more
reliable than counting subscribers and needs no extra API surface.

- Record the mode at connect time.
- In riding mode the list (057), health readout (059) and embed (065) all still work; creation and
  scheduling are disabled with a plain explanation that **YouTube is refusing, not the app**.
- This is a channel-eligibility fact, not a transient failure, so it belongs in **setup status, not
  health**. It must not escalate the health state or trigger the reauth banner.

Can be built against fixtures before issue 060 runs; 060 supplies the real refusal shape to check
the fixtures against.

## Acceptance criteria

- [ ] Each eligibility refusal code puts the app in riding mode.
- [ ] Riding mode is reported in setup status and never changes `cache.health`.
- [ ] A generic 5xx or network failure does **not** put the app in riding mode.
- [ ] The dashboard explains the mode in plain words, naming YouTube as the refuser.
- [ ] Creation and scheduling controls are disabled — not merely hidden — in riding mode.
- [ ] Read-only features remain fully functional in riding mode.

## Blocked by

- Blocked by `issues/060-test-3-app-created-broadcast-wins.md`

## User stories addressed

- User story 7
- User story 11

## Progress note — 2026-09-03

Built against fixtures, as this issue's "What to build" allows ahead of issue 060. Five of the six
acceptance criteria are met and covered by tests; the sixth is blocked on issue 062, not on 060.

**Done**

- `LIVE_NOT_ELIGIBLE` is its own error code. `mapYouTubeError` classifies all three refusal reasons
  *before* the 403 auth branch — previously they were indistinguishable from a dead token, so the
  app answered a channel-permission fact with a reconnect banner no reconnect could clear.
- The refusal reason rides on `AppError.reason`. Needed because every YouTube call in the repo maps
  its error at the call site, so by the time the poll loop sees a failure the Gaxios body is gone.
- `store.liveEligibility` (`unknown` | `driving` | `riding`) holds the mode with YouTube's verbatim
  reason and message. Recorded on the first refusal, idempotent so re-observing it every poll does
  not re-date the finding, and reset on connect and disconnect — a reconnect may be to a different
  channel entirely.
- Health is untouched: `StateCache.recordFailure` treats an eligibility refusal as a call that
  *reached* YouTube, so `cache.health` stays `ok` and the reauth banner never fires. Logged at
  `warn`, not `error`. A 5xx, a network failure and a 401 all still classify exactly as before.
- Reported in setup status (`GET /api/setup/status`) and on the dashboard state, so the notice
  needs no second fetch and `changeSignature` pushes on a mode change.
- Dashboard: `RidingModeNotice` names YouTube as the refuser in the glossary's canonical words and
  quotes YouTube's own refusal as evidence. Deliberately not a banner — in this rack a coloured
  left edge means a fault, and this is a standing constraint on a healthy connection. The Settings
  connection card names the mode beside the active flow.
- Copy lives once, in `LIVE_ELIGIBILITY_GLOSSARY` in `@app/shared` (issue 021's rule), which is
  also where `NO_TARGET_FOUND`-style error text is drawn from.

**Not done — blocked on issue 062, not on 060**

- [ ] *Creation and scheduling controls are disabled — not merely hidden — in riding mode.* There
      are no creation or scheduling controls yet; issue 062 builds them. `canCreateBroadcasts()` is
      exported from `@app/shared` for 062 to gate on, and `driving` is only ever recorded by a
      successful insert, which is also 062's to call via `noteDriving()`.

**For issue 060 to check**

The three reason strings and the assumption that all three arrive as HTTP 403 are taken from the
API docs, not from this channel. Issue 060's live run must confirm the verbatim refusal against
`ELIGIBILITY_REASONS` and the 403 gate in `eligibilityRefusal()` — the status gate is deliberate,
since a false positive here disables the feature permanently on an eligible channel.
