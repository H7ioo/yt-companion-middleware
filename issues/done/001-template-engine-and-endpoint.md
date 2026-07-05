# 001 — Template engine + trigger endpoint

## Parent PRD

`issues/prd.md`

## What to build

The backend-complete core of templated presets. Preset `title` and `description` can carry
`{name}` variables (auto-detected, no declaration), with inline defaults `{name|default}`
and `{{`/`}}` escaping. Each field gets an optional whole-sentence fallback. A resolver
turns a preset + a supplied `vars` map into final title/description text following the
per-field resolution order in PRD §2, and reports how each variable resolved.

Wire it into the preset trigger so `POST /api/action/preset` and
`POST /api/dashboard/action/preset` accept an optional `vars` object, return
`resolvedVars`, and reject with `MISSING_TEMPLATE_VARS` when a required variable is
unresolved and its field has no fallback (PRD §4). Extend `presetSchema` with nullable
`titleFallback`/`descriptionFallback` (PRD §3), keeping preset CRUD and export/import
backward compatible.

This slice is verifiable end-to-end via curl / the API console — no UI required.

## Acceptance criteria

- [x] `presetSchema` has optional nullable `titleFallback` and `descriptionFallback`; a
      preset saved/loaded/exported/imported without them still parses and behaves as today.
- [x] A resolver detects `{name}` variables in title and description, applies supplied
      values, then inline defaults `{name|default}`, and treats `{{`/`}}` as literal braces.
- [x] When a field has any unresolved variable and a fallback text is set, that field
      renders the fallback string; its variables report `source: "fallback"`.
- [x] When a field has an unresolved variable and no fallback text, the action is rejected
      with `success:false` and error `MISSING_TEMPLATE_VARS` listing the missing names.
- [x] Title and description resolve independently — a missing title variable does not force
      the description into fallback (and vice versa).
- [x] `POST /api/action/preset` and `POST /api/dashboard/action/preset` accept optional
      `vars` and return `resolvedVars: [{ name, value, source }]` with
      `source ∈ provided|default|fallback`.
- [x] A preset with no `{...}` produces no `resolvedVars` entries and behaves exactly as
      before.
- [x] Unit tests cover: plain preset, inline default used vs overridden, escaped braces,
      field fallback triggered by a missing var, `MISSING_TEMPLATE_VARS`, and independent
      per-field resolution.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
