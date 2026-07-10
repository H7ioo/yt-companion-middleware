## Parent PRD

`issues/prd-08-docs.md`

## What to build

Rewrite `README.md` as an audience router (PRD-08 §2, #8/#25): an **end-user path** (where releases
live, installer vs portable, Windows SmartScreen note, Linux via Docker, connect-YouTube via the
OAuth flow, importing the Companion `.tgz`) and a **developer path** (prereqs, `npm install`
workspaces, dev/run/build/test/preflight/release commands) — with **Windows and Linux** covered
wherever steps differ. Links to RELEASING/VERSIONING rather than restating them.

## Acceptance criteria

- [ ] README has distinct end-user and developer onboarding paths.
- [ ] Windows and Linux instructions given for every OS-specific step; desktop = Windows-only artifact called out honestly.
- [ ] Links to `RELEASING.md`, `VERSIONING.md`, `companion-module/README.md` instead of duplicating.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-08 §2 (#8, #25).
