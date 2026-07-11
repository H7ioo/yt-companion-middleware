## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

Fix the Electron font bug (PRD-07 §1, #1). `--font-display: "Archivo"` is referenced with no
`@font-face` and no bundled file, so headings fall back to Arial (worse offline in Electron).
Self-host Archivo as `woff2` (incl. the 800 weight) with an `@font-face` rule, no CDN, and verify
in a **packaged** Electron build.

## Acceptance criteria

- [x] Archivo woff2 bundled with an `@font-face`; no external fetch.
- [x] Display headings render in Archivo in the packaged Electron app (offline).
- [x] Verified in a real desktop build, not just the browser dev server.

## Implementation notes

- Bundled `packages/web/src/fonts/archivo-latin-var.woff2` (34.9 kB, latin subset). Archivo is a
  single variable font, so one file covers the 600/700/800 heading weights via a
  `font-weight: 100 900` range in one `@font-face`.
- `@font-face` added to [packages/web/src/styles.css](packages/web/src/styles.css) with a relative
  `url(./fonts/…)`, no CDN. Vite fingerprints it into `dist/assets/` at build time; the embedded
  server serves the whole `dist` statically, and Electron loads from `http://localhost`, so the
  font ships and resolves with zero network.
- Regression test [packages/web/src/lib/fonts.test.ts](packages/web/src/lib/fonts.test.ts) locks
  in the `@font-face`, the local `.woff2`, the woff2 magic bytes, and the absence of any
  `googleapis`/`gstatic`/`@import` reference.
- Verified via a production `vite build`: the emitted CSS references
  `/assets/archivo-latin-var-*.woff2` and no external font host appears in `dist`
  (the only `googleapis` strings are firewall-guidance copy, not fetches).
- Verified in a packaged build via `npm run desktop:pack` (`electron-builder --dir`,
  `release/linux-unpacked/`): the woff2 ships inside `app.asar` at
  `packages/web/dist/assets/archivo-latin-var-*.woff2`, the packaged CSS sources it with a local
  `url(/assets/…woff2)`, and no `fonts.gstatic`/`fonts.googleapis` string exists anywhere in the
  packaged dist. Binary is `release/linux-unpacked/yt-companion-middleware` (named from the root
  package `name`, not `productName`). The `win` NSIS installer target needs wine on Linux; the
  `--dir` asar is the equivalent packaged artifact for eyeballing here.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-07 §1 (#1).
