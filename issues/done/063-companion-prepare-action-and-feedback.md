## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Put preparation on a key. PRD-16 user stories 11.

- An action that prepares tonight's broadcast from a preset — one press, no screen.
- A feedback showing whether a broadcast is prepared and bound, so the state is checkable before the
  show without looking at a dashboard.

Per AGENTS.md this is a new action and a new feedback, so: **`npm run companion:bump minor` in the
same PR**, and the SDK-free helpers in `transform.js` get their behaviour test-first before being
wired into `main.js`.

## Acceptance criteria

- [ ] A Companion action prepares a broadcast from a chosen preset.
- [ ] A feedback distinguishes "prepared and bound" from "nothing prepared" and from "prepared but
      not bound".
- [ ] In riding mode the action reports a clear refusal on `last_error` rather than failing
      silently.
- [ ] New `transform.js` helpers are unit-tested before use.
- [ ] Module version bumped with `companion:bump minor`; `companion:package` preflight passes.
- [ ] No upgrade script is needed (additive change) — confirmed, not assumed.

## Blocked by

- Blocked by `issues/062-prepare-and-schedule-a-broadcast.md`

## User stories addressed

- User story 11
