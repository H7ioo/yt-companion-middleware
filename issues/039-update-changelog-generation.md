## Parent PRD

`issues/prd-09-autoupdate-changelog.md`

## What to build

Auto-generate the changelog (PRD-09 §B.1): produce `CHANGELOG.md` (Keep a Changelog format) from
Conventional Commit history at release time (`conventional-changelog` / `release-please`), grouped
by type and stamped with version + date, feeding the **GitHub Release body** so GitHub and the file
agree. One source, zero manual authoring.

## Acceptance criteria

- [ ] `CHANGELOG.md` is generated from Conventional Commits, grouped by type, version+date stamped.
- [ ] The GitHub Release notes come from the same source (no divergence).
- [ ] Generation runs as part of the release flow.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-09 §B.1.
