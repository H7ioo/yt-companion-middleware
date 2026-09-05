## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Delete any broadcast on the channel from the app, not only the ones this app made. PRD-16 §5
amendment and §9.

Today `deletePrepared` refuses anything without an ownership record, and the Delete button only
appears in the "Made here" list on the Schedule page. A broadcast scheduled in Studio — including
a stale one months past its start time, still sitting in the list, still pinnable — has no way out
except Studio.

**This does not weaken the cleanup guard, and the distinction must survive in the code.**
Automatic retirement still only ever touches app-created broadcasts, under any condition; that
rule is what stops the background job eating something a human scheduled. What changes is that an
operator pressing Delete on a row they chose, and answering a question about it, is not the
background job. The line is not who created the broadcast — it is whether a human is deciding.

The confirmation already exists and is the right one: the watch link, struck through, because that
is exactly what the press does to it. It carries over unchanged for broadcasts the app did not
make. For those, the dialog cannot promise the link is unshared — say plainly that the app did not
create this one and cannot know where its link has been.

A broadcast that has already aired keeps its current protection: it is a recording people may
still be watching. That guard is about the artifact, not about ownership, so it applies to
everything.

## Acceptance criteria

- [ ] Delete is offered on any row of the Broadcasts page, whatever created it.
- [ ] The struck-through-link confirmation is shown before every deletion.
- [ ] The confirmation for a broadcast the app did not create says so, and does not claim to know
      the link's reach.
- [ ] A broadcast that has aired is never offered for deletion, app-created or not.
- [ ] The automatic retire path is unchanged: a test asserts it still never touches a broadcast
      without an ownership record.
- [ ] Deleting a broadcast that is currently pinned clears the pin, and the list says the target
      is gone rather than silently re-choosing.
- [ ] Deleting a broadcast the app created still records it as retired, so the "Made here" record
      keeps its history rather than losing the row.
- [ ] The activity log records who deleted what.

## Blocked by

- Blocked by `issues/069-broadcasts-page-management-surface.md`

## User stories addressed

- User story 15
