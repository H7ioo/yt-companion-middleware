## Parent PRD

`issues/prd-05-release-safety.md`

## What to build

Fill the test gap (PRD-05 §2, #28): **route integration tests** (supertest / app-level fetch)
against the express routers with a mocked YouTube client, asserting the PRD-01 §7 contract (actions
always 200 with body-encoded success/error; correct error codes; auth/quota mapping) and the
dual-alias guarantee (`/api/action/*` and `/api/dashboard/action/*` hit the same handler). Plus a
**release smoke test** that boots the built server and asserts `GET /health` → 200 + shape.

## Acceptance criteria

- [ ] Integration tests cover action, feedback, dashboard, setup, settings, streams, presets routes.
- [ ] Error-code mapping and the always-200 contract are asserted.
- [ ] Dual-alias equivalence is tested.
- [ ] Release smoke test boots the server and checks `/health`; wired into preflight + CI.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-05 §2 (#28).
