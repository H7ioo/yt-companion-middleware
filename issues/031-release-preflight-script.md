## Parent PRD

`issues/prd-05-release-safety.md`

## What to build

The local `preflight` script (PRD-05 §1.1, #27/#11): one root command mirroring everything CI does
except OS packaging — `typecheck` + `typecheck:electron`, all tests (workspaces + `companion:test`),
`build:all`, `companion:package` (version-sync guard), and an `electron-builder --dir` pack to
catch builder config/glob errors. Consolidates common commands into root `package.json` (#11).

## Acceptance criteria

- [ ] `npm run preflight` runs typecheck, tests, build, companion package, and a `--dir` pack.
- [ ] It fails fast on any broken step and runs without Wine on Linux.
- [ ] Common workflow commands are present in the root `package.json`.

## Blocked by

- Blocked by `issues/010-monorepo-repoint-ci.md`

## User stories addressed

N/A. See PRD-05 §1.1 (#27, #11).
