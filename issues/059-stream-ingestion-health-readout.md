## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Surface YouTube's ingestion state for the bound stream, in the dashboard and as a Companion
feedback. PRD-16 §3.

This is what replaces the single most common mid-show Studio trip: **"is it stuck on preparing?"**
It reads `liveStreams.list` (`status.streamStatus` and `status.healthStatus` — confirm the exact
values while implementing), and it is independent of everything else in this PRD.

Small, cheap, read-only, and shippable today. Alongside issue 057 it covers most of why Studio gets
opened at all.

Note the distinction the UI must keep clear: this is the **live** signal. The embedded player
(issue 065) is the audience's delayed view and answers a different question.

## Acceptance criteria

- [ ] The dashboard shows the bound stream's ingestion status and health, in plain words rather
      than raw API values.
- [ ] "Receiving video", "nothing arriving" and "arriving with problems" are visually distinct.
- [ ] A Companion feedback exposes the same state for a key.
- [ ] The mapping from API values to displayed states is a pure function, table-tested including
      unknown/unexpected values.
- [ ] The added quota cost is measured and stated.
- [ ] No stream bound, or no credentials, degrades to a clear message rather than an error.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 4
