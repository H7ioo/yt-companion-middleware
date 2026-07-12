## Parent PRD

`issues/prd-05-release-safety.md`

## What to build

Document the **desktop-app semver rule** in `RELEASING.md` (PRD-05 §3, #29): patch = fix/internal,
minor = new backward-compatible feature/endpoint, major = removed/renamed endpoint or breaking
Companion-facing change (coordinate with a companion major + upgrade script). Desktop (git tag) and
companion (in-repo) versions stay independent.

## Acceptance criteria

- [ ] `RELEASING.md` states the desktop-app patch/minor/major rule.
- [ ] It notes the desktop/companion versions are independent.
- [ ] Cross-references `companion-module/VERSIONING.md` rather than duplicating it.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-05 §3 (#29).
