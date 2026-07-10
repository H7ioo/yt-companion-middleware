## Parent PRD

`issues/prd-04-monorepo.md`

## What to build

Repoint `.github/workflows/release.yml` at the new `packages/*` layout and **prove the pipeline
end-to-end** via `workflow_dispatch` and/or a pre-release tag before the next real release
(PRD-04 §4 stage 6). CI-touching slices (preflight, auto-update) block on this. HITL: cutting a
tag needs a human.

## Acceptance criteria

- [ ] `release.yml` builds desktop + companion from the new paths.
- [ ] A `workflow_dispatch` run is green and produces the desktop artifacts.
- [ ] A pre-release tag proves publish works; `companion-module` `.tgz` still ships unchanged.
- [ ] `RELEASING.md` path references updated.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A — infrastructure. See PRD-04 §4 stage 6, §5.
