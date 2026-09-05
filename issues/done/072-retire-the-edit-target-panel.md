## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Remove the Edit target panel. PRD-16 §8.

Since issue 058 the Live page carries **two radio groups writing the same state**. "What will air"
sets the pin; "Edit target" sets the pin. One page, one value, two controls — and they read as two
different questions, which is exactly the confusion reported: *"What will air and Edit target
aren't those the same thing?!"*

They are not the same *question* — the verdict is YouTube's (which broadcast the encoder will
actually feed), the pin is ours (where this app writes) — but they are the same *control*, and the
list is the better one. It carries the evidence the choice turns on: the bound key, auto-start,
privacy, the reason a broadcast is out. The picker shows less and duplicates the press.

So: delete `TargetPicker`, and make sure nothing it said is lost. The list already states the pin
("Target" flag), already offers "Choose automatically" as a first-class row, and already warns via
`Disagreement` when the pin and the airing marker point at different broadcasts. What must survive
the deletion:

- the paused-API sentence naming the pin that will be used on resume, which the list does not say
- the "you are on air, actions edit the live broadcast whatever is chosen here" lede
- the "pinned broadcast is no longer on the channel" recovery, which `Disagreement` covers — verify
  it does before removing the picker's copy

Keeping both panels while merely relabelling them is not the fix. Two controls over one value is
how the two surfaces start disagreeing.

## Acceptance criteria

- [x] `TargetPicker.tsx` and `TargetPicker.test.tsx` are removed, along with the Live page's use of
      them.
- [x] The broadcast list remains the only control that writes the pin.
- [x] The paused-API case still names the broadcast actions will target on resume.
- [x] The on-air case still states that edits go to the live broadcast regardless of the pin.
- [x] A pin pointing at a broadcast that has left the channel still offers a way back.
- [x] `/api/dashboard/target/candidates` is removed if nothing else reads it, or its remaining
      caller is named in the PR.
- [x] No dead CSS is left behind for the `patch__*` classes if nothing else uses them.

## Blocked by

Nothing.

## User stories addressed

- User story 1

## What was done

Branch `retire-edit-target-panel`.

- `TargetPicker.tsx` / `TargetPicker.test.tsx` deleted; `LivePage` no longer renders them, and the
  page's doc comment says why the order lost its last panel.
- Two sentences the picker said alone moved into `BroadcastList`: the paused-API line now names the
  broadcast actions resume onto (or says nothing is pinned and the app will choose), and an on-air
  lede states that edits go to the live broadcast whatever is targeted.
- `Disagreement` became `disagreement(listing, pin): string | null` so the caller can render exactly
  one sentence about where actions land — the specific warning when it has something to say, the
  general on-air lede otherwise. Two at once is how an operator learns to skip both.
- The "pinned broadcast has left the channel" recovery was verified to live in `disagreement`
  before the picker's copy went, and keeps its existing test.
- `GET /api/dashboard/target/candidates` removed — nothing else read it — along with the
  `BroadcastCandidate` contract type, the web client method, and the two integration tests that
  covered the route. `PUT /api/dashboard/target` is untouched.
- Dead `patch__row*`, `patch__meta`, `patch__title`, `patch__note` and `.patch` CSS removed. The
  prose classes (`patch__lede`, `patch__error`, `patch__empty`) and the `patch__id` chip stay: half
  the panels in the app use them, so the section comment was rewritten rather than the names.

`npm run test` (1427 passed) and `npm run typecheck` both green.
