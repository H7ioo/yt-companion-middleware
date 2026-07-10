## Parent PRD

`issues/prd-09-autoupdate-changelog.md`

## What to build

Electron auto-update, streaming-safe (PRD-09 §A): add `electron-updater` with GitHub provider,
**check on launch → background download → manual "Install & restart" only** (`autoInstallOnAppQuit`
OFF, never mid-stream). Configure the electron-builder `publish` provider and change `release.yml`
to **emit and attach `latest.yml` + blockmaps** (currently explicitly skipped). NSIS-only; portable
excluded from the feed; stays unsigned for now. HITL: first tagged release is the feed smoke test.

## Acceptance criteria

- [ ] `electron-updater` checks GitHub on launch and downloads in the background.
- [ ] Install happens only on explicit user action; never auto-restarts.
- [ ] `release.yml` produces + attaches `latest.yml` + blockmaps; provider configured.
- [ ] Portable/Docker excluded; failures are logged, not fatal.

## Blocked by

- Blocked by `issues/010-monorepo-repoint-ci.md`

## User stories addressed

N/A. See PRD-09 §A.
