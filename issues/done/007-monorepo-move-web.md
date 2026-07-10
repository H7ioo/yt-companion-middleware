## Parent PRD

`issues/prd-04-monorepo.md`

## What to build

Move the web app to `packages/web` (PRD-04 §4 stage 3). Update `vite.config.ts` paths, the root
scripts that build/serve the web bundle, and the electron web-dist path so `desktop:dev` still
serves the UI.

## Acceptance criteria

- [x] Web app lives under `packages/web`; `@app/web` builds via workspace scripts.
- [x] Vite output + electron's web-dist reference point at the new location.
- [x] `npm run desktop:dev` serves the dashboard correctly.
- [x] Web still imports the contract from `@app/shared`.

## Blocked by

- Blocked by `issues/006-monorepo-extract-shared-package.md`

## User stories addressed

N/A — infrastructure. See PRD-04 §2, §4 stage 3.

## Completion note

`git mv web packages/web` (clean renames, no content churn). Repointed every reference:

- Root `package.json`: `workspaces` `web` -> `packages/web`; `build:web`/`build:all` use
  `--prefix packages/web`; electron-builder `files` glob `web/dist/**` -> `packages/web/dist/**`.
- `src/server.ts`: static web-dist mount `../web/dist` -> `../packages/web/dist`. This is the
  same static mount electron's window loads, so `desktop:dev` picks up the new path for free.
- `.gitignore`: `web/dist/` + `web/node_modules/` -> `packages/web/...`.
- `.github/workflows/release.yml`: dropped the redundant `npm ci` in `working-directory: web`
  (workspaces install every package from the root lockfile; that dir has no lockfile since 005).
- `README.md` local-dev commands re-pointed to `packages/web`.
- `npm install` regenerated the root lockfile with the `packages/web` workspace path.

`vite.config.ts` (outDir `dist`) and `web/tsconfig.json` are dir-relative, so no edits needed.

Verified: `npm run typecheck` (0), `packages/web` build (vite 38 modules -> dist), `npm test`
(123 passed, incl. the relocated `fillRoute`/`template` web tests still picked up by root vitest),
`typecheck:electron` (0), `build:all` clean. Booted `dist/server.js` and confirmed `GET /` -> 200
serving `packages/web/dist/index.html` (hashed bundle, `id="root"`) and `GET /api/dashboard/state`
-> 200 — the exact static mount desktop:dev's electron window loads.

Next: PRD-04 stage 4 — extract server into `packages/server` (`@app/server`).
