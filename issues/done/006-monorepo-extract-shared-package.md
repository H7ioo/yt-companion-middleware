## Parent PRD

`issues/prd-04-monorepo.md`

## What to build

Extract `packages/shared` holding the zod schemas + inferred types (moved out of
`src/storage/schema.ts`), and point both server and `web/src/api.ts` at it — **deleting the
duplicated interfaces in `api.ts`** (PRD-04 §2, §4 stage 2). This is the core win: one contract,
so adding a schema field becomes a type error in the web app until handled.

## Acceptance criteria

- [x] `packages/shared` exports the zod schemas and their inferred types.
- [x] Server imports validation schemas from `@app/shared` (no behavior change).
- [x] `web/src/api.ts` imports contract types from `@app/shared`; no hand-duplicated interfaces remain.
- [x] Adding a field to a shared schema produces a web-side type error until the UI handles it.
- [x] Server + web typecheck and tests pass against the single contract.

## Completion note (2026-07-10)

- New `@app/shared` workspace (`packages/shared`) is the single contract. It holds the zod
  schemas + inferred types (moved verbatim from `src/storage/schema.ts`) in `src/schema.ts`, and
  the HTTP/DTO response types web used to hand-copy (`DashboardState`, `ResolvedVar`/`VarSource`,
  `QuotaSnapshot`, `StreamInfo`, `Category`, `FeedbackStatus`, `HealthFeedback`, `SetupStatus`,
  `PresetActionResult`) in `src/contract.ts`. Compiles to `dist` (declaration + JS) so the Node
  server/electron resolve it at runtime and vite bundles it into the web build.
- `src/storage/schema.ts` is now a one-line re-export shim of `@app/shared` (PRD §4 "server
  re-exports, no behavior change"), so all ~14 server import sites are untouched. The server DTO
  modules (`template`, `quota`, `streams`, `categories`, `snapshot`) drop their local interface
  and `export { … } from "@app/shared"` instead — one definition, re-exported on the old paths.
- `web/src/api.ts` lost every duplicated interface; it now re-exports the contract from
  `@app/shared` (components' `import … from "../api.js"` sites unchanged) and keeps only the
  derived `PresetInput = Omit<Preset,"id">` / `CredentialsInput`.
- Workspace/build wiring: root `workspaces` gains `packages/shared`; `@app/shared` is a
  dependency of both root (server, so electron-builder bundles it) and web. Root scripts gain
  `build:shared`, sequenced ahead of `build`/`build:web`/`build:all`/`test`/`typecheck` (vitest
  imports the compiled contract). Added `*.tsbuildinfo` to `.gitignore` (untracked the two
  generated files).
- Verified: server + web + electron typecheck (0), `npm test` (123), `build:all` all green.
  **Drift bug proven dead**: temporarily adding a required field to `presetSchema` produced
  TS2345/TS2322 errors in `web/src/components/PresetForm.tsx` + `web/src/lib/template.test.ts`
  (reverted). `desktop:build` packaged `node_modules/@app/shared/dist` into `app.asar` and failed
  only at the wine code-sign step (Linux-host limit; real `--win` runs on CI). Runtime smoke test
  confirmed `@app/shared` resolves + parses from both the package and the server shim.

## Blocked by

- Blocked by `issues/005-monorepo-introduce-workspaces.md`

## User stories addressed

N/A — infrastructure. See PRD-04 §1 (the `api.ts` duplication drift bug).
