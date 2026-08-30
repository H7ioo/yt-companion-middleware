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
