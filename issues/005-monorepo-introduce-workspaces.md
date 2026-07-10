## Parent PRD

`issues/prd-04-monorepo.md`

## What to build

Turn the repo into an npm workspace **without moving any files yet** (PRD-04 §4 stage 1). Add a
`workspaces` array to the root `package.json` covering the existing `web` (and root as server),
confirm a single `npm install` wires them, and that `npm run desktop:build` still produces the
same artifacts. This is the baseline the rest of the restructure builds on. `companion-module`
stays out of the workspace.

## Acceptance criteria

- [ ] Root `package.json` declares `workspaces`; one `npm install` installs all in-scope packages.
- [ ] `companion-module` is excluded and still installs/packages via its `--prefix` scripts.
- [ ] `npm run build:all`, `npm test`, and `npm run desktop:build` all pass unchanged.
- [ ] No source files moved in this slice.

## Blocked by

None - can start immediately.

## User stories addressed

N/A — infrastructure. See PRD-04 §1 (drift-bug rationale) and §4 stage 1.
