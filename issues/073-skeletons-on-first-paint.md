## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Make a panel that is loading look like it is loading. PRD-16 §9.

There are no skeletons anywhere in the dashboard. What exists instead is a line of prose —
"Reading the channel…", "Waiting for the connection…" — and in the case of the "Made here" list,
nothing at all: it returns `null` until it has items, so it pops into existence. Panels reserve no
height, so the page jumps as each one lands.

**First paint only.** A skeleton belongs where a panel has never had data. A manual Refresh keeps
the rows that are already on screen, with the button reading "Reading…" as it does now — replacing
good data with grey bars every time the operator presses Refresh is worse than the flash it would
prevent, particularly for a list that costs quota to read.

The skeletons imitate the real shape — the lamp, the title line, the facts row — so that the
transition to data is a change of content and not a change of layout.

Panels to cover: the broadcast list, the prepared/"Made here" list, the ingestion readout, the
activity panel, and the presets list.

## Acceptance criteria

- [ ] Each covered panel renders skeleton rows while it has never held data.
- [ ] A manual refresh of an already-loaded panel keeps the existing rows visible and does not show
      skeletons.
- [ ] A skeleton row occupies the same height as the real row it stands in for.
- [ ] Skeletons never appear for a panel that is deliberately not loading — a paused API or riding
      mode still shows its explanation, not a fake load.
- [ ] An error replaces the skeleton rather than leaving them animating forever.
- [ ] Skeletons are hidden from assistive technology, and the panel announces its loading state
      once rather than per row.
- [ ] The animation respects `prefers-reduced-motion`.

## Blocked by

Nothing.

## User stories addressed

- User story 16
