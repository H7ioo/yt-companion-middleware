## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Remove "persistent container" from the dashboard, the guide and the glossary. PRD-16
§Implementation Decisions.

It names a thing YouTube deprecated on 2020-09-01 and deleted, it returns zero results on the test
channel, and it actively misleads about what the idle target is. PRD-13 flagged it; this is where it
gets done.

The health/vocabulary copy is centralised — `HEALTH_GLOSSARY` in `@app/shared` is the canonical
source (issue 021), so the fix belongs there rather than in each surface.

Small, independent, and safe to do at any point.

## Acceptance criteria

- [x] No user-facing surface uses "persistent container": dashboard, guide, glossary, Companion
      strings.
- [x] Replacement wording describes what the idle target actually is.
- [x] The wording is defined once in the shared glossary, not restated per surface.
- [x] A test or grep guard prevents the phrase reappearing.

## Blocked by

None - can start immediately.

## User stories addressed

None directly — copy correctness supporting user stories 1 and 7.

## Done — 2026-09-02

`TARGET_GLOSSARY` / `describeTarget` added to `@app/shared` as the target slice of the glossary:
what an edit lands on (`live` / `upcoming` / `none`), which is a different axis from broadcast
state (what the stream is doing) and from the dashboard's Target readout (how the target was
chosen). The idle target is now named for what it is — **the next upcoming broadcast**.

Consumed rather than restated: `AdHocModal`'s target badge and the `NO_TARGET_FOUND` default
message both read from the glossary. The two static guide pages can't import at runtime, so they
are hand-aligned per the rule in `packages/shared/GLOSSARY.md`.

`packages/shared/src/glossaryGuard.test.ts` is the grep guard. It scans only operator-facing
surfaces, so the legitimate survivors are untouched: the `broadcastType: "persistent"` API
parameter (YouTube's own word, kept for pre-2020 channels) and the Companion module's "persistent
WebSocket". A comment that must quote the retired phrase marks its line `[retired]` — a per-line
exemption that shows up in the diff.

Note for whoever picks up the resolver: the `broadcastType: "persistent"` fallback in
`resolveTarget` is still there. That is deliberate — this issue was copy, not behaviour — but it is
dead on any channel enabled for live since 2020-09-01, and PRD-16's work is the place to decide
whether it earns its two API calls.
