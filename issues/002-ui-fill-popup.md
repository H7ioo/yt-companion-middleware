# 002 — UI fill popup for templated presets

## Parent PRD

`issues/prd.md`

## What to build

The dashboard fill experience for templated presets (PRD §5). Selecting a preset that
contains variables opens a popup with one input per detected variable; a preset with no
variables fires immediately with no extra click. Inline defaults and field fallbacks show
as greyed placeholder text, last-used values prefill per preset (stored client-side), and a
read-only live preview shows the resolved title and description as the user types (applying
fallback when a field is left blank). Submitting fires
`POST /api/dashboard/action/preset` with the collected `vars` and shows success/error
inline, surfacing `resolvedVars`/`MISSING_TEMPLATE_VARS` from slice 001.

This is HITL: it needs design review (invoke the `frontend-design` skill) since it adds a
new interactive surface to the dashboard.

## Acceptance criteria

- [ ] Selecting a variabled preset opens the fill popup; a variable-less preset fires
      immediately (no popup), matching current behavior.
- [ ] The popup renders one input per variable detected in the preset's title/description.
- [ ] Each input shows its inline default / field fallback as greyed placeholder text;
      leaving it blank uses that fallback path.
- [ ] Last-used values for a preset prefill the inputs on reopen (persisted client-side).
- [ ] A read-only live preview of the resolved title and description updates as the user
      types and reflects fallback when a field is left empty.
- [ ] Submitting sends the `vars` map, fires the action, and shows success or the error
      (including `MISSING_TEMPLATE_VARS`) inline.
- [ ] Design reviewed via the `frontend-design` skill; visual style matches the existing
      dashboard.

## Blocked by

- Blocked by `issues/001-template-engine-and-endpoint.md`

## User stories addressed

- User story 5
- User story 6
