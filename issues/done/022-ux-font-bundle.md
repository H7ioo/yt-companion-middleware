## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

Fix the Electron font bug (PRD-07 §1, #1). `--font-display: "Archivo"` is referenced with no
`@font-face` and no bundled file, so headings fall back to Arial (worse offline in Electron).
Self-host Archivo as `woff2` (incl. the 800 weight) with an `@font-face` rule, no CDN, and verify
in a **packaged** Electron build.

## Acceptance criteria

- [ ] Archivo woff2 bundled with an `@font-face`; no external fetch.
- [ ] Display headings render in Archivo in the packaged Electron app (offline).
- [ ] Verified in a real desktop build, not just the browser dev server.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-07 §1 (#1).
