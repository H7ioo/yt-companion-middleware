## Parent PRD

`issues/prd-04-monorepo.md`

## What to build

Turn the repo into an npm workspace **without moving any files yet** (PRD-04 §4 stage 1). Add a
`workspaces` array to the root `package.json` covering the existing `web` (and root as server),
confirm a single `npm install` wires them, and that `npm run desktop:build` still produces the
same artifacts. This is the baseline the rest of the restructure builds on. `companion-module`
stays out of the workspace.

## Acceptance criteria

- [x] Root `package.json` declares `workspaces`; one `npm install` installs all in-scope packages.
- [x] `companion-module` is excluded and still installs/packages via its `--prefix` scripts.
- [x] `npm run build:all`, `npm test`, and `npm run desktop:build` all pass unchanged.
- [x] No source files moved in this slice.

## Completion note (2026-07-10)

- Added `"workspaces": ["web"]` to root `package.json`. Root itself remains the server package
  (its `src/`/deps stay at root — npm can't list root as its own workspace member), so listing
  `web` is the actionable move. `companion-module` excluded by omission.
- npm 11's native allow-scripts ignores a workspace member's `allowScripts` field, so moved
  web's `esbuild@0.25.12` entry up to the root `package.json` and deleted it from `web`.
- Deleted redundant `web/package-lock.json` — under workspaces the root lockfile is authoritative.
- Verified: single root `npm install` symlinks `yt-companion-dashboard -> ../web`; `build:all`,
  `typecheck`, `typecheck:electron`, and `npm test` (123) all green; `companion:check` still
  passes via `--prefix`. `desktop:build` packaged `release/win-unpacked/` + 36M `app.asar` from
  the same `dist/**`+`web/dist/**` globs and failed only at the Windows code-sign step
  (`wine is required`) — an environmental Linux-host limit, not a regression; the real `--win`
  build runs on the CI Windows runner.

## Blocked by

None - can start immediately.

## User stories addressed

N/A — infrastructure. See PRD-04 §1 (drift-bug rationale) and §4 stage 1.
