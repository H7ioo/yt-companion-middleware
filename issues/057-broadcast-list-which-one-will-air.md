## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

The read-only answer to the question that currently forces a Studio trip: **which broadcast will
actually air?** PRD-16 §1.

A list of upcoming and live broadcasts showing, for each: title, scheduled start, privacy, the
stream it is bound to, and whether auto-start is on. One is marked as the one that will air — the
bound, auto-start-enabled event on the key the encoder uses — **with the reason stated in plain
words**, not just a highlight.

This needs no permission to create anything and does not depend on Test 3 (issue 060). Together
with issue 059 it is the highest-value slice in this PRD, and it can ship today.

The selection logic is a pure function over listed broadcasts, so it is testable against the real
shapes from the 2026-08-05 session and the August re-tests.

## Acceptance criteria

- [ ] The dashboard lists upcoming and live broadcasts with title, start, privacy, bound stream and
      auto-start state.
- [ ] Exactly one entry is marked as the one that will air, with a human-readable reason.
- [ ] When nothing qualifies, the list says so plainly rather than marking an arbitrary entry.
- [ ] When two entries compete, both are flagged rather than one silently winning.
- [ ] The selection logic is a pure function, table-tested with the recorded real-world shapes.
- [ ] Listing is paginated correctly — the default page size of 5 is what hid the real target in
      the original bug.
- [ ] The list's quota cost is measured and stated.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 1
