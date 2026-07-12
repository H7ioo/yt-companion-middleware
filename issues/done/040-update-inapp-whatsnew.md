## Parent PRD

`issues/prd-09-autoupdate-changelog.md`

## What to build

In-app changelog (PRD-09 §B.2): bundle the generated `CHANGELOG.md` into the Electron build; show a
**"What's New"** panel on first launch after a version change (and on demand from Settings/About),
and surface the **new** version's notes inside the auto-update "update available" banner — all read
from the bundled changelog, offline, version-accurate.

## Acceptance criteria

- [ ] `CHANGELOG.md` is bundled into the build (electron-builder `files`).
- [ ] A "What's New" panel shows the current version's section after an update and on demand.
- [ ] The update banner shows the target version's notes before install.
- [ ] Works offline; content matches the running/target version.

## Blocked by

- Blocked by `issues/038-update-electron-updater.md`
- Blocked by `issues/039-update-changelog-generation.md`

## User stories addressed

N/A. See PRD-09 §B.2.
