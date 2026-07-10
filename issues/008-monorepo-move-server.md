## Parent PRD

`issues/prd-04-monorepo.md`

## What to build

Move the server to `packages/server`, taking `scripts/` and `public/` with it (PRD-04 §2, §4
stage 4). Update tsconfig project references, the Dockerfile COPY/build/start paths, and the
electron server-dist path.

## Acceptance criteria

- [ ] Server (+ `scripts/`, `public/`) lives under `packages/server`.
- [ ] `npm start` and the Docker build run the server from the new location.
- [ ] tsconfig project references resolve `@app/shared`.
- [ ] Electron loads the server from `packages/server/dist`.

## Blocked by

- Blocked by `issues/006-monorepo-extract-shared-package.md`

## User stories addressed

N/A — infrastructure. See PRD-04 §2, §4 stage 4.
