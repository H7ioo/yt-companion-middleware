## Parent PRD

`issues/prd-04-monorepo.md`

## What to build

Move the server to `packages/server`, taking `scripts/` and `public/` with it (PRD-04 §2, §4
stage 4). Update tsconfig project references, the Dockerfile COPY/build/start paths, and the
electron server-dist path.

## Acceptance criteria

- [x] Server (+ `scripts/`, `public/`) lives under `packages/server`.
- [x] `npm start` and the Docker build run the server from the new location.
- [x] tsconfig project references resolve `@app/shared`.
- [x] Electron loads the server from `packages/server/dist`.

## Blocked by

- Blocked by `issues/006-monorepo-extract-shared-package.md`

## User stories addressed

N/A — infrastructure. See PRD-04 §2, §4 stage 4.

## Completion note

`git mv`'d `src/`, `scripts/`, `public/`, `assets/` and the old root `tsconfig.json` into
`packages/server/`. New `@app/server` workspace owns the server; root is now (almost) an
orchestrator — Electron + electron-builder still live here until stage 5.

Decisions:

- **`assets/` moved with the server.** `titleImage.ts` resolves the bundled Arabic font at
  `../../assets` relative to its compiled location, so the font has to sit beside the server's
  `dist/` to keep resolving. (Kept it out of the electron-builder `files` globs — the desktop
  build never bundled it, PNG rendering degrades gracefully; parity preserved.)
- **Clean dependency split, no root duplication.** Root `dependencies` is just `@app/server`;
  all server runtime deps (express, googleapis, @napi-rs/canvas, nanoid, ws, dotenv, zod) live
  only in `@app/server`. Verified electron-builder follows the workspace link and bundles them
  (see below), so duplicating them at root was unnecessary.
- **Project references.** Root `tsconfig.json` is now a solution (`files: []`, references
  shared + server); `packages/server/tsconfig.json` is `composite` and references `../shared`.
  `npm run build` = `tsc -b tsconfig.json` builds shared -> server in order.
- **Renamed web `yt-companion-dashboard` -> `@app/web`** so the workspace scope is consistent
  (shared/server/web all `@app/*`); root scripts now use `-w @app/web`.
- Root scripts delegate to workspaces (`dev`/`start`/`build:server`/`typecheck` via `-w
  @app/server`); electron server path -> `../packages/server/dist/server.js`; server's web-dist
  mount -> `../../web/dist`; electron-builder `files` globs re-pointed to `packages/server/...`.
- **Dockerfile** rewritten for workspaces: copy every workspace manifest, `npm ci`,
  `build:all`; runtime stage `npm ci --omit=dev` + copy each package's built output; `CMD node
  packages/server/dist/server.js`.

Verified: `build:all`, `typecheck`, `typecheck:electron`, `npm test` (123) all green.
`npm start` boots from `packages/server/dist` and serves `/` (200, `id="root"`), `/docs` (200),
`/api/*`. `desktop:pack` (linux `--dir`) produced an app.asar containing `@app/server`,
`@app/shared`, and every runtime dep, with the canvas `.node` in `app.asar.unpacked`. Built the
Docker image and ran it: `[server] listening ...`, `GET /` -> 200, `GET /docs` -> 200.

Next: PRD-04 stage 5 — move electron -> `packages/desktop` (electron-builder block + its
tsconfig), leaving root a pure orchestrator.
