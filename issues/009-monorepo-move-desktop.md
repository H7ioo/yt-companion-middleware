## Parent PRD

`issues/prd-04-monorepo.md`

## What to build

Move electron to `packages/desktop`, carrying the electron-builder `build{}` block and desktop
deps into its own `package.json`; the root `package.json` becomes a pure workspace orchestrator
(PRD-04 §2, §4 stage 5). Re-point the electron-builder `files`/`asarUnpack` globs at
`packages/server/dist`, `packages/web/dist`, `packages/server/public`,
`packages/desktop/main.mjs`. **This slice completing = the restructure is done; all non-monorepo
work is blocked on it.**

## Acceptance criteria

- [ ] `packages/desktop` owns `main.mjs`, assets, scripts, and the electron-builder config.
- [ ] Root `package.json` holds only workspace orchestration (no app code/build config).
- [ ] `npm run desktop:build` produces the same NSIS installer + portable exe as before.
- [ ] `npm run desktop:pack` (`--dir`) succeeds against the new globs.

## Blocked by

- Blocked by `issues/007-monorepo-move-web.md`
- Blocked by `issues/008-monorepo-move-server.md`

## User stories addressed

N/A — infrastructure. See PRD-04 §2, §4 stage 5.
