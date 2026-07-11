## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

Disambiguate the two "refresh" actions everywhere (PRD-07 §5, #19): **Refresh state** (force a live
YouTube GET, `/api/action/refresh`) vs **Refresh lists** (re-fetch presets/categories/streams).
Apply the two canonical labels (from the glossary) to the dashboard buttons, the Companion action
names, and the guide. Companion label changes → module bump.

## Acceptance criteria

- [x] Dashboard, Companion, and guide use distinct, canonical labels for the two refresh actions.
- [x] Any Companion action rename carries a `companion:bump` + upgrade script in the same PR.
- [x] Labels come from the glossary (021).

## Done (2026-07-12)

Issue 021 had already routed the dashboard rail through `ACTION_GLOSSARY.refreshState.label`
("Refresh from YouTube") and hand-aligned the guide + Companion action names, so the two refreshes
were mostly disambiguated. This slice closed the last drift and locked it down:

- **Real drift fixed:** `companion/HELP.md` still listed the state refresh as **"Refresh cache"** —
  the exact pre-021 term the glossary forbids. Renamed to **Refresh from YouTube**.
- **Regression guard:** `companion-module/src/vocabulary.test.js` reads the shipped Companion copy
  (`main.js` action names, `HELP.md`, `README.md`) and fails if either canonical refresh label goes
  missing or the legacy "Refresh cache" label reappears — the Companion analogue of the web's
  `vocabulary.test.ts`, since the module can't import `@app/shared` at runtime.
- **Bump:** copy-only change to a shipped module doc → **patch** (`1.2.0 → 1.2.1`). No action/option
  id was renamed or reshaped, so per `VERSIONING.md` **no upgrade script** is required (AC #2:
  vacuously satisfied — there was no action rename to migrate).

Surface audit after the change — all canonical, all distinct:

| Surface | State refresh | List refresh |
|---|---|---|
| Dashboard (`StatusRail.tsx`) | Refresh from YouTube (from glossary) | _(no button — lists auto-load)_ |
| Companion actions (`main.js`) | `refresh` → "Refresh from YouTube" | `refresh_lists` → "Refresh lists (…)" |
| Companion presets / README / HELP | Refresh from YouTube | Refresh lists |
| Guide (`public/guide.html`) | Refresh from YouTube | Refresh lists |

The `refresh_lists` action name keeps its "(presets, categories, streams)" parenthetical: it leads
with the canonical "Refresh lists" label and follows the house style of the other verbose Companion
action names (cf. `check_connection`).

Tests: full suite **210 pass** (10 new companion vocabulary assertions), typecheck clean,
`companion:check` version-sync green.

## Blocked by

- Blocked by `issues/021-ux-vocabulary-glossary.md`

## User stories addressed

N/A. See PRD-07 §5 (#19).
