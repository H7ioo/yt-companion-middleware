## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Clean up after ourselves, and let the operator cancel deliberately. PRD-16 §5.

Broadcasts **this app created**, that never aired and whose time has passed, are retired
automatically.

**This is not housekeeping.** YouTube refuses `insert` once too many live or scheduled broadcasts
exist (`limitExceeded` / `userBroadcastsExceedLimit`), so uncleaned ghosts eventually block
preparation on the night it matters most.

- **Only broadcasts this app created are ever candidates.** A human-made broadcast is never touched,
  under any condition. No API field distinguishes a real scheduled show from a Studio stray, which
  is exactly why the ownership record from issue 062 is the only safe basis for deletion.
- Manual cancel/delete is available too, and **deleting a broadcast whose link has already been
  shared requires a confirmation** — it breaks the link for everyone holding it. This is the
  sibling of the confirmation in issue 051.

## Acceptance criteria

- [ ] An app-created, unused, past-due broadcast is retired.
- [ ] A broadcast the app did not create is never retired, under any condition — asserted by test.
- [ ] A broadcast that aired is never retired.
- [ ] Manual delete requires a confirmation naming the broadcast and warning about the shared link.
- [ ] Hitting the broadcast limit is reported with an explanation and a pointer to cleanup, not as a
      generic failure.
- [ ] Retirements are recorded where the operator can see what was removed and why.

## Blocked by

- Blocked by `issues/062-prepare-and-schedule-a-broadcast.md`

## User stories addressed

- User story 6
- User story 10
