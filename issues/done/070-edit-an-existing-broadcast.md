## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Change a broadcast after it exists, without opening Studio. PRD-16 §9.

Right now the only things reachable on an existing broadcast are an ad-hoc title/description
update and a privacy toggle, both aimed at the pinned target. There is no way to retime a show
that moved, fix a title on a broadcast that is not the target, or correct the key it is bound to.

**The editable set is YouTube's, and it depends on lifecycle state.** This is the whole design
problem — a form that greys half its fields without saying why reads as broken.

Editable in **any** state:

- `snippet.title`, `snippet.description`
- `snippet.scheduledStartTime`, `snippet.scheduledEndTime`
- `status.privacyStatus`
- category — not a broadcast field at all, but `videos.update snippet.categoryId` on the video
  resource, which `resolve.ts` already tracks separately

Editable **only while `created` or `ready`**, refused with `forbidden` once testing or live:

- every `contentDetails` flag — `enableAutoStart`, `enableAutoStop`, `enableDvr`,
  `enableClosedCaptions`, `enableEmbed`, `recordFromStart`, `monitorStream`
- rebinding the ingestion key, which is `liveBroadcasts.bind` and fails with
  `liveBroadcastBindingNotAllowed`

Each locked field says why it is locked, in the vocabulary the app already uses for lifecycle
("on air", "encoder bound, previewing"). The state is read from the resource, never assumed from
the will-air marker.

**Rides on the existing write path.** `writeBroadcast` is already read-modify-write and already
refuses a body missing a field YouTube would delete (PRD-16 §7). This issue adds a route and a
form on top of it. An edit that reaches `liveBroadcasts.update` by any other path is a bug.

Two consequences to surface rather than hide:

1. **An edit costs a read plus a write**, because the whole resource is re-sent. Say so where the
   Prepare panel says what preparing costs.
2. **Retiming can change what will air.** Moving a start time reorders the will-air ranking and
   can hand the automatic choice to a different broadcast. The list re-reads its verdict after a
   successful edit, so the operator sees the consequence immediately.

## Acceptance criteria

- [ ] A broadcast row on the Broadcasts page opens an edit form for that broadcast.
- [ ] Title, description, scheduled start, scheduled end, privacy and category are editable while
      the broadcast is `created` or `ready`.
- [ ] Title, description, scheduled times, privacy and category remain editable while the
      broadcast is `testing` or `live`.
- [ ] `contentDetails` flags and the ingestion key are disabled once the broadcast is `testing` or
      `live`, each with a stated reason, and are editable before that.
- [ ] Every write goes through `writeBroadcast`; a test asserts an edit of one field re-sends the
      rest, and that dropping a field is refused.
- [ ] A category change goes to `videos.update`, not into the broadcast body.
- [ ] A rebind uses `liveBroadcasts.bind`, and `liveBroadcastBindingNotAllowed` is reported as a
      state refusal, not as a generic failure.
- [ ] The quota cost of an edit is stated in the form before the press.
- [ ] After a successful edit the list re-reads, so a retimed broadcast's effect on the will-air
      verdict is visible without a manual refresh.
- [ ] Editing is available on any broadcast on the channel, not only app-created ones.
- [ ] Riding mode and a paused API disable editing with the same plain explanation used elsewhere.

## Blocked by

- Blocked by `issues/069-broadcasts-page-management-surface.md`

## User stories addressed

- User story 14
