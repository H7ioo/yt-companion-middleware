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

- [ ] No user-facing surface uses "persistent container": dashboard, guide, glossary, Companion
      strings.
- [ ] Replacement wording describes what the idle target actually is.
- [ ] The wording is defined once in the shared glossary, not restated per surface.
- [ ] A test or grep guard prevents the phrase reappearing.

## Blocked by

None - can start immediately.

## User stories addressed

None directly — copy correctness supporting user stories 1 and 7.
