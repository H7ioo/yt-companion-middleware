## Parent PRD

`issues/prd-06-observability.md`

## What to build

Dashboard logging (PRD-06 §3): a small in-memory ring-buffer `logger` module (last ~200 events,
shape `{ ts, level, category, code, message }`) that the cache/runner/routes push into, exposed
via `GET /api/dashboard/logs` (newest-first, LAN-trust), and a dashboard **Activity** panel
(color-coded by level, filterable by category). Optionally streamed over the existing SSE/WS
change channel for live updates. Auth/network entries link to their guidance.

## Acceptance criteria

- [x] `logger` ring buffer captures auth/network/quota/action/system events with categories.
- [x] `GET /api/dashboard/logs` returns the buffer newest-first.
- [x] Dashboard Activity panel renders, color-codes by level, filters by category.
- [x] Failures classified in 016 appear with the correct category.

## Implementation notes

- `core/logger.ts` — in-memory ring buffer (200), `categoryForCode`/`levelForCode` keep the
  panel's categories aligned with the 016 health classification. Not persisted (live feed, not
  audit); a restart starts fresh.
- Producers push in: `StateCache` (refresh failures + a recovery line), `ActionRunner`
  (write success/failure), `QuotaTracker` (one-time 90% budget warning).
- `GET /api/dashboard/logs` (LAN-trust) returns the buffer newest-first; wired in `server.ts`
  alongside a "middleware started" system line.
- Web `ActivityPanel` polls every 4s, filter chips per present category, severity via tally-dot
  colour; auth/network rows link to `/guide`. SSE streaming (optional) not wired — polling suffices.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-06 §3 (#3).
