## Parent PRD

`issues/prd-04-monorepo.md`

## What to build

Extract `packages/shared` holding the zod schemas + inferred types (moved out of
`src/storage/schema.ts`), and point both server and `web/src/api.ts` at it — **deleting the
duplicated interfaces in `api.ts`** (PRD-04 §2, §4 stage 2). This is the core win: one contract,
so adding a schema field becomes a type error in the web app until handled.

## Acceptance criteria

- [ ] `packages/shared` exports the zod schemas and their inferred types.
- [ ] Server imports validation schemas from `@app/shared` (no behavior change).
- [ ] `web/src/api.ts` imports contract types from `@app/shared`; no hand-duplicated interfaces remain.
- [ ] Adding a field to a shared schema produces a web-side type error until the UI handles it.
- [ ] Server + web typecheck and tests pass against the single contract.

## Blocked by

- Blocked by `issues/005-monorepo-introduce-workspaces.md`

## User stories addressed

N/A — infrastructure. See PRD-04 §1 (the `api.ts` duplication drift bug).
