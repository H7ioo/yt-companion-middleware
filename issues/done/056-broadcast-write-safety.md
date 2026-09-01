## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Make every write to a broadcast safe before anything starts writing more of them. PRD-16 §7.

`liveBroadcasts.update` **deletes any property omitted from the request**, and requires the
`monitorStream` fields to be re-sent. Today that hazard is survivable because the app edits one
live target. The moment a list of scheduled broadcasts is being managed, one sloppy write silently
wipes a description or turns auto-start off on tonight's show — and nothing looks broken until air.

- Route every broadcast write through a single read-modify-write path: fetch current state, apply
  the change, send the whole resource back.
- Cover the fields the app does not otherwise care about — `monitorStream`, `enableDvr`,
  `recordFromStart`, `enableAutoStart`/`enableAutoStop` — so they survive an unrelated edit.
- No behaviour change is intended for today's flows. This is a latent-hazard fix that happens to be
  a prerequisite.

## Acceptance criteria

- [x] All broadcast writes go through one path; no route builds its own update body.
- [x] Changing one field leaves every other field on the resource unchanged — asserted against a
      faked client with a fully-populated resource.
- [x] A regression that drops a field from the request body fails a test.
- [x] `monitorStream` fields are always re-sent.
- [x] Existing preset-apply and privacy-toggle behaviour is unchanged.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 9

## Done

`packages/server/src/youtube/broadcastWrite.ts` is now the only place that calls
`liveBroadcasts.update`. It takes the resource as fetched *and* the merged copy, refuses the write
when the merged copy has lost any key the fetched one had (`BROADCAST_WRITE_UNSAFE`, raised before
the request leaves the process), and guarantees `contentDetails.monitorStream` is on the body —
filling YouTube's documented defaults only when the GET carried none. `BROADCAST_PARTS` moved there
too, so the parts read and the parts written cannot drift apart.

`ResolvedPlan` gained `original` — the untouched GET — which is what makes the check possible
without a second read. No behaviour change to preset-apply, privacy-toggle or undo; all 982 tests
pass unchanged.
