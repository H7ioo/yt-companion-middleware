## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

Add a **copy button to every preset row** in the dashboard that copies the pre-filled fill/redirect
data (PRD-07 §10, #23) — default to the `/fill?preset=<id>&...` URL (most useful for the redirect
flow, PRD-02 §6), optionally a second "copy JSON" for the direct-API path. Makes wiring a
Companion button one click.

## Acceptance criteria

- [ ] Each preset row has a copy button that copies the fill-route URL to the clipboard.
- [ ] (Optional) a second control copies the JSON payload for the direct-API path.
- [ ] Copied value is correct and ready to paste into Companion.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-07 §10 (#23); relates to PRD-02 §6 redirect flow.
