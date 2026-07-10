## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

Polish the stream-key selection (PRD-07 §4, #13). The data + stale-key warning already exist in
`PresetForm`/`AdHocModal`; ensure the stream binding is a **`<select>` dropdown** of
`{title — streamName}` (not free-text) with an explicit "inherit default" option showing the
resolved default label.

## Acceptance criteria

- [ ] Stream binding is a dropdown of the channel's live streams in both PresetForm and AdHocModal.
- [ ] An "inherit default" option shows the resolved default stream label.
- [ ] The existing stale/unknown-key warning still shows.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-07 §4 (#13).
