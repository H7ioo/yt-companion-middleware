## Parent PRD

`issues/prd-04-monorepo.md`

## What to build

Repoint `.github/workflows/release.yml` at the new `packages/*` layout and **prove the pipeline
end-to-end** via `workflow_dispatch` and/or a pre-release tag before the next real release
(PRD-04 §4 stage 6). CI-touching slices (preflight, auto-update) block on this. HITL: cutting a
tag needs a human.

## Acceptance criteria

- [x] `release.yml` builds desktop + companion from the new paths.
- [ ] A `workflow_dispatch` run is green and produces the desktop artifacts. **(HITL — pending)**
- [ ] A pre-release tag proves publish works; `companion-module` `.tgz` still ships unchanged. **(HITL — pending)**
- [x] `RELEASING.md` path references updated.

## Progress notes (code done; CI proof HITL-pending)

**Finding:** `release.yml` needed no structural path changes — it already drives the build through
orchestrator scripts (`npm ci`, `npm run desktop:build`) and globs `release/*.exe`, none of which
hardcode `web/` / `dist/` / `electron/`. The monorepo moves (stages 3–5) kept those entry points
stable by design, so CI "repointing" here is comment/doc accuracy + end-to-end proof.

Changes:
- `.github/workflows/release.yml`: refreshed the stale install comment (electron + electron-builder
  now live in `packages/desktop`; the win32 `@napi-rs/canvas` binary in `packages/server`; workspaces
  install `packages/{shared,server,web,desktop}`), and documented that the tag version stamp bumps
  the **root** package.json because electron-builder's app dir is the workspace root, plus that the
  config is `packages/desktop/electron-builder.yml`. Job graph unchanged (desktop / companion /
  release); companion job untouched (`working-directory: companion-module`, own lockfile).
- `RELEASING.md`: `public/guide.html` → `packages/server/public/guide.html`;
  `companion/HELP.md` → `companion-module/companion/HELP.md` in the docs checklist.

Verified locally (green): YAML parses (3 jobs, 6 desktop steps); `typecheck:electron`,
`desktop:icons`, `build:all` all pass. The only step not runnable here is `electron-builder --win`
(needs Windows/wine) — that is exactly what the HITL CI run proves.

**Remaining (human, on GitHub) — this issue stays open until done:**
1. Trigger the workflow manually to prove the desktop artifacts build green:
   `gh workflow run release.yml --ref <this-branch>` (or Actions tab → Release → Run workflow),
   then `gh run watch`. `workflow_dispatch` builds both artifacts but does not publish.
2. Cut a pre-release tag (e.g. `v2.0.1-rc.1`) to prove the publish path + that the companion
   `.tgz` still ships unchanged; delete the tag/Release afterward if it was only a rehearsal.
   Note the branch must be merged to a ref CI runs from, or dispatch against the branch.
CI-touching slices (preflight, auto-update) stay blocked until #1–#2 pass.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A — infrastructure. See PRD-04 §4 stage 6, §5.
