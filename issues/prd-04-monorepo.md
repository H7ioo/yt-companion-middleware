# PRD — Monorepo Restructure (npm workspaces)

Covers grill-me item **#15**. Restructures the repo into npm workspaces under `packages/*`,
with the primary goal of a **single shared API contract** consumed by both server and web.

---

## 1. Why (the real justification)

`web/src/api.ts` **hand-duplicates the entire server contract** — `Preset`, `PrivacyStatus`,
`ResolvedVar`, `DefaultSettings`, `StreamInfo`, `FeedbackStatus` — each mirroring a zod schema in
`src/storage/schema.ts`. Web imports **nothing** from the server today, so the two sides drift
silently: add a preset field server-side, forget to mirror it, and the UI is wrong with **zero
type error**.

The monorepo exists to **kill this drift** via a shared package both sides import. "One install
command" is a cosmetic side benefit, not the point.

**Non-goal:** pnpm/turborepo. Already on npm; a new tool adds migration + CI churn for marginal
gain at 3 packages / one dev. Turbo's task caching is pointless here. **Tool = npm workspaces.**

---

## 2. Target layout

```
/                      workspace root — private, orchestrator only (no app code)
/packages/shared       zod schemas + inferred types (the single contract)
/packages/server       today's src/ + scripts/ + public/  (imports @app/shared)
/packages/web          today's web/  (imports @app/shared; api.ts loses the dup types)
/packages/desktop      today's electron/ + the electron-builder `build` block
/companion-module      UNCHANGED — stays OUT of the workspace
```

### Decisions locked

- **companion-module stays out.** It shares no code (only `@companion-module/base` + `ws`), is a
  separately distributed `.tgz` imported into Bitfocus Companion, has independent versioning (the
  AGENTS.md hard rule) and its own `release.yml`. Workspace hoisting could break the standalone
  tarball. Keep the `--prefix companion-module` scripts exactly as they are.
- **Electron → `packages/desktop`**, owning its own `package.json` with the `build{}`
  (electron-builder) block and desktop-only deps. Root `package.json` becomes a pure workspace
  orchestrator.
- **scripts/ and public/ → `packages/server`.** They import server code / are served by express,
  so they belong to the server package.
- **shared exports the zod schemas *and* their inferred types.** Server imports them for
  validation (replaces `src/storage/schema.ts` as the source of truth); web imports the types
  (and may import schemas for client-side validation). `web/src/api.ts` shrinks to fetch wrappers.

Package names: `@app/shared`, `@app/server`, `@app/web`, `@app/desktop` (or the repo's chosen
scope). `shared` is a workspace dependency of `server`, `web`, and `desktop`.

---

## 3. What the migration rewrites (blast radius)

- **electron-builder** `files` globs + `main`: repackage from `packages/server/dist`,
  `packages/web/dist`, `packages/server/public`, `packages/desktop/main.mjs` — not the old
  `dist/**` + `web/dist/**`.
- **Dockerfile**: COPY paths and the build/`start` invocation move to the server package.
- **tsconfig**: `tsconfig.json` → per-package tsconfigs + a root solution with **project
  references** (`shared` referenced by `server`/`web`/`desktop`). `tsconfig.electron.json` moves
  into `packages/desktop`.
- **Root scripts**: every `--prefix web` / `build:all` / `desktop:*` becomes workspace-aware
  (`npm run build -w @app/web`, etc.). (Cross-refs item **#11** — consolidate scripts.)
- **vite.config.ts**: base/output paths under `packages/web`.
- **CI `release.yml`**: all path references to `dist/`, `web/dist/`, `electron/` re-pointed.
- **Cross-boundary imports**: the electron→server `dist/server.js` path is hardcoded today; it
  moves to `packages/server/dist`. Few other crossings exist.

---

## 4. Staged migration (never leave the repo unreleasable)

Each stage builds, typechecks, tests, and produces a runnable desktop build before the next.

1. **Introduce workspaces, no moves.** Add `workspaces` to root `package.json` listing existing
   dirs where possible; confirm `npm install` still yields a working `desktop:build`. Baseline.
2. **Extract `packages/shared`.** Move the zod schemas out of `src/storage/schema.ts` into
   `@app/shared`; server re-exports from there (no behavior change). Point `web/src/api.ts` at
   `@app/shared` types and **delete the duplicated interfaces**. This delivers the core win
   early; verify web + server typecheck against one contract.
3. **Move web → `packages/web`.** Update vite config, root scripts, electron web-dist path.
   Verify `desktop:dev` serves the UI.
4. **Move server → `packages/server`** (with scripts/ + public/). Update tsconfig refs, Docker,
   electron server path. Verify `npm start` + Docker build.
5. **Move electron → `packages/desktop`** with the electron-builder config + its tsconfig.
   Root becomes orchestrator-only. Verify `desktop:build` produces installers identical in shape
   to today.
6. **Repoint CI** (`release.yml`) and cut a **pre-release tag** to prove the pipeline end-to-end
   before the next real release. (Cross-refs the release-safety cluster — a local dry-run should
   exist by then, item **#27**.)

Stages 1–2 alone fix the drift bug and can ship independently if the full move stalls.

---

## 5. Acceptance

- `web/src/api.ts` contains **no** duplicated contract types — all come from `@app/shared`.
- Adding a field to a shared schema is a **type error** in web until the UI handles it.
- `npm install` at root wires all four workspaces; `companion-module` still installs/packages via
  its own `--prefix` scripts and produces an unchanged `.tgz`.
- `desktop:build` produces the same NSIS + portable artifacts; Docker build still runs the server.
- CI release from a `v*` tag still publishes desktop app + companion `.tgz`, proven via a
  pre-release tag first.

---

## 6. Out of scope

- Moving `companion-module` into the workspace.
- pnpm / turborepo / nx.
- Any runtime/behavior change — this is a **structure-only** migration; features land in their own
  PRDs.
