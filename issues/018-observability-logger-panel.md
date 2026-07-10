## Parent PRD

`issues/prd-06-observability.md`

## What to build

Dashboard logging (PRD-06 §3): a small in-memory ring-buffer `logger` module (last ~200 events,
shape `{ ts, level, category, code, message }`) that the cache/runner/routes push into, exposed
via `GET /api/dashboard/logs` (newest-first, LAN-trust), and a dashboard **Activity** panel
(color-coded by level, filterable by category). Optionally streamed over the existing SSE/WS
change channel for live updates. Auth/network entries link to their guidance.

## Acceptance criteria

- [ ] `logger` ring buffer captures auth/network/quota/action/system events with categories.
- [ ] `GET /api/dashboard/logs` returns the buffer newest-first.
- [ ] Dashboard Activity panel renders, color-codes by level, filters by category.
- [ ] Failures classified in 016 appear with the correct category.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-06 §3 (#3).
