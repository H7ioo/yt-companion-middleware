## Parent PRD

`issues/prd-08-docs.md`

## What to build

Modularize the docs (PRD-08 §1, #17): split the 1990-line `guide.html` and 822-line `docs.html`
into focused standalone pages under `public/guide/` and `public/docs/` with a **shared nav** — no
build step, self-contained (inline CSS/JS, no CDN) so it works offline in Electron. Preserve
existing anchors or add redirects.

## Acceptance criteria

- [ ] Guide/docs split into topic pages with a shared nav header/sidebar.
- [ ] Pages are self-contained and render offline in the packaged app.
- [ ] Existing deep links still resolve (preserved anchors or redirects).

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-08 §1 (#17).
