## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

Add JSDoc type safety to native JS (PRD-07 §11, #14): annotate `companion-module/` (`main.js`,
`src/*.js`, `scripts/*.mjs`) and `packages/desktop/*.mjs` with `@param`/`@returns`/`@typedef`, and
enable `checkJs` in the relevant jsconfig so `tsc --noEmit` enforces them.

## Acceptance criteria

- [ ] JS files carry JSDoc annotations for parameters/returns/shared typedefs.
- [ ] `checkJs` enabled; `tsc --noEmit` passes and would catch type mismatches.
- [ ] `companion-module/src/transform.js` stays typed + unit-tested (AGENTS.md).

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-07 §11 (#14).
