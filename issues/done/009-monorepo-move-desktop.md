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

- [x] `packages/desktop` owns `main.mjs`, assets, scripts, and the electron-builder config.
- [x] Root `package.json` holds only workspace orchestration (no app code/build config).
- [~] `npm run desktop:build` produces the same NSIS installer + portable exe as before.
- [x] `npm run desktop:pack` (`--dir`) succeeds against the new globs.

## Completion notes

Moved `electron/` → `packages/desktop/` (`main.mjs`, `assets/`, `scripts/make-icons.mjs`); the
electron-builder `build{}` block became `packages/desktop/electron-builder.yml`;
`tsconfig.electron.json` → `packages/desktop/tsconfig.json`. New `@app/desktop` workspace owns
`electron` + `electron-builder` + `@napi-rs/canvas` (icon gen) devDeps and the `icons`/`typecheck`
scripts. Root is now an orchestrator: `desktop:*` scripts delegate/invoke, the big build config is
gone.

Key decision — **electron-builder app dir stays the workspace ROOT** (config loaded via
`electron-builder -c packages/desktop/electron-builder.yml`). A true two-package layout
(`directories.app: packages/desktop` + `from`/`to` file maps) was implemented first but
electron-builder 25's `asarUnpack` matcher rejects files mapped in from outside the app dir
(`… must be under packages/desktop/`), which breaks unpacking the server's `@napi-rs/canvas`
`.node`. App-dir-at-root keeps the asar tree byte-identical to the pre-move build, so the runtime's
relative lookups (`main.mjs → ../server/dist`, server `→ ../../web/dist` / `../public`) resolve
unchanged, and CI's root `npm version` stamp still reaches the installer name.
`extraMetadata.main: packages/desktop/main.mjs` injects the entry into the packaged manifest.

Consequence: root keeps `dependencies: { "@app/server": "*" }` — electron-builder collects the
app's prod deps from the app-dir (root) manifest, so this one dep must live there to bundle the
server + transitive deps. It is a packaging necessity, not app logic. Root also keeps `main`
(re-added by a formatting pass) pointing at the desktop entry, which conveniently makes `electron .`
work in dev too.

Verified: `npm run typecheck`, `typecheck:electron`, `npm test` (123), and `npm run desktop:pack`
(`--dir`) all green. Inspected `app.asar`: `/packages/desktop/main.mjs`,
`/packages/server/{dist,public}`, `/packages/web/dist`, `/package.json` (main → desktop entry) all
present; `node_modules` bundles `@app/server`, `@app/shared`, express, googleapis, `@napi-rs`,
nanoid, ws, dotenv, zod; canvas `.node` in `app.asar.unpacked`.

`[~]` NSIS/portable: the Windows targets (`--win`) can't run on this Linux host (needs wine), so
the `.exe` installers weren't produced here. The `win`/`nsis`/`portable` config is carried over
verbatim from the previous known-good root block and the asar payload is byte-shape-identical, so
CI (`release.yml`, unchanged — still `npm run desktop:build` + `release/*.exe`) should build the
same artifacts. **Stage 6 to verify on `windows-latest`.**

## Blocked by

- Blocked by `issues/007-monorepo-move-web.md`
- Blocked by `issues/008-monorepo-move-server.md`

## User stories addressed

N/A — infrastructure. See PRD-04 §2, §4 stage 5.
