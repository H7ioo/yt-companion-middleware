## Parent PRD

`issues/prd-04-monorepo.md`

## What to build

Move the web app to `packages/web` (PRD-04 §4 stage 3). Update `vite.config.ts` paths, the root
scripts that build/serve the web bundle, and the electron web-dist path so `desktop:dev` still
serves the UI.

## Acceptance criteria

- [ ] Web app lives under `packages/web`; `@app/web` builds via workspace scripts.
- [ ] Vite output + electron's web-dist reference point at the new location.
- [ ] `npm run desktop:dev` serves the dashboard correctly.
- [ ] Web still imports the contract from `@app/shared`.

## Blocked by

- Blocked by `issues/006-monorepo-extract-shared-package.md`

## User stories addressed

N/A — infrastructure. See PRD-04 §2, §4 stage 3.
