## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

Establish the **canonical vocabulary** (PRD-07 §2, #10): one source of truth for user-facing state
names, health states/colors (`ok`/`degraded`/`offline`/`auth_error`), and action names (preset,
update, privacy toggle, undo, refresh state, refresh lists). Prefer a shared constants map in
`@app/shared` plus a short documented glossary. Audit dashboard copy, companion labels, and
`public/guide.html` against it and align. HITL: the canonical term choices are decisions.

## Acceptance criteria

- [x] Canonical terms defined once (shared constants and/or glossary doc).
- [x] No "on air" vs "is live" style drift across dashboard, companion, guide.
- [x] Downstream slices (offline label, refresh naming, explainer) consume this source.

## Done (2026-07-11)

Extended the existing `@app/shared` glossary (health slice shipped in issue 020) with the remaining
two slices and a documented glossary:

- `packages/shared/src/glossary.ts`: added `describeBroadcastState` / `BROADCAST_STATE` (live/idle)
  and `ACTION_GLOSSARY` (the PRD-07 §2 #10 actions, each bound to its endpoint).
- `packages/shared/GLOSSARY.md`: short human doc + settled term choices.
- `StatusRail.tsx` now consumes `describeBroadcastState` and `ACTION_GLOSSARY.refreshState.label`
  instead of inlining copy — the drift source is gone.
- Hand-aligned the two surfaces that can't import at runtime: `companion-module/` (main.js + README)
  and `packages/server/public/guide.html`.

HITL term choices (asked): live = **On Air**, idle = **Idle**, state refresh = **Refresh from
YouTube** (kept distinct from **Refresh lists**).

Tests: `packages/web/src/lib/vocabulary.test.ts` (3, via the `@app/shared` public export). Full
suite 183 pass, typecheck clean, web build + companion tests pass.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-07 §2 (#10).
