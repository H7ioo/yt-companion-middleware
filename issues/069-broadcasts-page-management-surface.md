## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

One page that owns the collection of broadcasts. PRD-16 §9.

Today the work is scattered across three places and a browser tab: Schedule creates and deletes
app-made broadcasts, Live lists everything and pins one, and anything else — retitling, retiming,
deleting something made in Studio — is a trip to Studio. That detour is what this PRD exists to
end.

Add a **Broadcasts** page to the navbar. It carries the full list, and it is where a broadcast is
acted on: edit (issue 070), delete (issue 071), copy link.

**Live keeps its list.** Read-only plus pinning, exactly as it is now. This is deliberate and not
a duplication to be tidied away later: Schedule and Live are separated because they are done at
different times by different people — the afternoon's setup at a keyboard, versus what is watched
during the show. At 22:58 the operator must not be changing pages to see what will air. The two
surfaces render the same data with different powers.

`BroadcastList` therefore grows a notion of what it is allowed to do, rather than being copied.
The verdict, the row evidence and the `Disagreement` warning are the same code on both pages;
whether a row offers Edit and Delete is the difference.

Schedule stays the create form and hands off — after creating, it points at the new broadcast's
row on this page rather than growing management controls of its own.

## Acceptance criteria

- [ ] A Broadcasts entry exists in the navbar, and the page lists upcoming and live broadcasts.
- [ ] Each row carries the same evidence the Live list shows: start, bound key, auto-start,
      privacy, id, and the will-air marker with its reason.
- [ ] Rows on the Broadcasts page offer Edit, Delete and Copy link; rows on the Live page do not.
- [ ] The Live page still lists broadcasts and still sets the pin, unchanged.
- [ ] Both surfaces render from one component and one fetch path — no second copy of the will-air
      logic, and no second notion of the pin.
- [ ] The list is read on demand on this page too, never polled, with its quota cost stated as the
      Live list states it.
- [ ] Paused API and riding mode are handled here exactly as they are on Live: explained, not
      silently empty.
- [ ] The "Made here" record of app-created broadcasts remains reachable, and does not become a
      second list of the same broadcasts on this page.

## Blocked by

Nothing. Issues 070 and 071 depend on this.

## User stories addressed

- User story 13
