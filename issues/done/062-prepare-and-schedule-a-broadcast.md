## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

The feature the operator actually asked for: create a broadcast ahead of time, get its link, and
have the title right from the first frame. PRD-16 §2.

An explicit dashboard action that inserts a broadcast from a preset or an ad-hoc payload, binds it
to the **existing reusable stream** (the key OBS already holds — creating a new stream would mean
re-pasting a key into OBS, which defeats the point), and sets `enableAutoStart` and
`enableAutoStop`.

- **Metadata is set at insert**, so the title is correct at air rather than corrected seconds later.
- **The share link is shown and copyable as soon as the broadcast exists.** This is the whole reason
  scheduling matters.
- **Scheduling for a future date is in scope** (it was explicitly out of scope in PRD-13).
- **Never a side effect.** Applying a preset must not create a broadcast. Creating a public
  broadcast is a deliberate press, always.
- **Ownership record.** Persist which broadcasts this app created; only those are ever cleanup
  candidates (issue 064), and target resolution prefers them while they live.
- Quota: insert and bind are 50-unit writes each, ~100 per preparation against 10,000/day. State it
  in the UI or the guide.

## Acceptance criteria

- [ ] An explicit action creates a broadcast with title, description, privacy, category and
      scheduled start taken from the operator's input.
- [ ] The new broadcast is bound to the existing reusable stream; no new stream is created.
- [ ] `enableAutoStart` and `enableAutoStop` are set at insert.
- [ ] The share link is displayed and copyable immediately.
- [ ] Applying a preset or an ad-hoc update never issues an insert — asserted by test.
- [ ] The created broadcast id and our ownership of it are persisted.
- [ ] The insert → bind sequence is tested against a faked client, asserting the request body
      carries the operator's metadata rather than patching it afterwards.
- [ ] A refused insert surfaces riding mode (issue 061) rather than a raw error.

## Blocked by

- Blocked by `issues/060-test-3-app-created-broadcast-wins.md`
- Blocked by `issues/056-broadcast-write-safety.md`
- Blocked by `issues/061-riding-mode-eligibility-detection.md`

## User stories addressed

- User story 2
- User story 3
- User story 8
- User story 12
