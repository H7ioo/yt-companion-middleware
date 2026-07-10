## Parent PRD

`issues/prd-03-auth.md`

## What to build

A first-class **Settings page** (PRD-03 §3): a Connection section (status, which flow is in use,
Connect / Reconnect / Disconnect) plus the existing app defaults (`defaultCategory` /
`defaultStreamBoundId`) in one place. Extends `/api/setup/status` to report connection state as
booleans; Docker renders read-only guidance.

## Acceptance criteria

- [ ] Settings page reachable any time (not just first run).
- [ ] Shows connection status + active flow (bundled vs override); Connect/Reconnect/Disconnect work.
- [ ] App defaults editable from the same page.
- [ ] Secrets never returned; status is booleans only.
- [ ] Docker/headless shows read-only env/CLI guidance.

## Blocked by

- Blocked by `issues/012-auth-inapp-oauth-flow.md`

## User stories addressed

- User story 4
