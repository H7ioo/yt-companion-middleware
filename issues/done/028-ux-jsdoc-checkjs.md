## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

Add JSDoc type safety to native JS (PRD-07 §11, #14): annotate `companion-module/` (`main.js`,
`src/*.js`, `scripts/*.mjs`) and `packages/desktop/*.mjs` with `@param`/`@returns`/`@typedef`, and
enable `checkJs` in the relevant jsconfig so `tsc --noEmit` enforces them.

## Acceptance criteria

- [x] JS files carry JSDoc annotations for parameters/returns/shared typedefs.
- [x] `checkJs` enabled; `tsc --noEmit` passes and would catch type mismatches.
- [x] `companion-module/src/transform.js` stays typed + unit-tested (AGENTS.md).

## Done

Desktop side (`packages/desktop/*.mjs`) was already `@ts-check`ed + `checkJs` under
`packages/desktop/tsconfig.json` from issue 009. This issue closed the `companion-module/` gap:

- New `companion-module/jsconfig.json` (mirrors the desktop config): strict `checkJs`, ESM/NodeNext,
  includes `main.js`, `src/**/*.js`, `scripts/**/*.mjs`; excludes `pkg/` and `*.test.*` (tests pull
  vitest types the module doesn't vendor — the root vitest run checks them).
- `// @ts-check` + JSDoc on `main.js`, `src/transform.js`, `src/upgrades.js`, both `scripts/*.mjs`.
- `main.js`: `ModuleConfig`/`Preset`/`NamedItem` typedefs, `@augments {InstanceBase<ModuleConfig>}`,
  instance state declared as class fields (a method-only-assigned prop infers `T | undefined`),
  `errText(err)` helper for `unknown` catch bindings, `ws` import `@ts-ignore`d (no `@types/ws`).
- Wired `typecheck:companion` into root `npm run typecheck` (uses root tsc 5.9, not the module's
  local tsc 7 preview).

No companion version bump: JSDoc/type-hygiene only, no behaviour change (class-field defaults are
identical to the prior init-time assignments).

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-07 §11 (#14).
