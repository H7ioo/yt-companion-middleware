## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

Establish the **canonical vocabulary** (PRD-07 §2, #10): one source of truth for user-facing state
names, health states/colors (`ok`/`degraded`/`offline`/`auth_error`), and action names (preset,
update, privacy toggle, undo, refresh state, refresh lists). Prefer a shared constants map in
`@app/shared` plus a short documented glossary. Audit dashboard copy, companion labels, and
`public/guide.html` against it and align. HITL: the canonical term choices are decisions.

## Acceptance criteria

- [ ] Canonical terms defined once (shared constants and/or glossary doc).
- [ ] No "on air" vs "is live" style drift across dashboard, companion, guide.
- [ ] Downstream slices (offline label, refresh naming, explainer) consume this source.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-07 §2 (#10).
