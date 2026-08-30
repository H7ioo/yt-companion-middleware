## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Wire the new list to the existing target pin, so there is one concept rather than two competing
ones. PRD-16 §8.

The pin (`store.targetPin`, `resolveTarget(yt, now, pinnedId)`, `/api/dashboard/target`) is what
makes today's flow work and is not superseded by this PRD. Selecting a broadcast in the list
**sets the pin** — same state, surfaced two ways. The pin remains the answer to "which broadcast do
my actions apply to".

The list must also show when the pin and the would-air marker disagree, because that is a real and
confusing situation: your actions are going somewhere other than what is about to air.

## Acceptance criteria

- [ ] Selecting a broadcast in the list sets the pin, and the existing pin UI reflects it.
- [ ] Clearing the pin from either surface clears it in both.
- [ ] When the pinned broadcast is not the one marked as airing, the disagreement is shown
      explicitly.
- [ ] Existing pin behaviour and its tests are unchanged.

## Blocked by

- Blocked by `issues/057-broadcast-list-which-one-will-air.md`

## User stories addressed

- User story 3
