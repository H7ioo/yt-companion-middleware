# PRD — Templated Presets, Companion Redirect Flow & LAN-only Auth

## Overview

Extend the existing preset system so preset **title** and **description** can carry
fill-in variables, resolved either through a UI popup or via arguments on the trigger
endpoint. Add a browser round-trip ("redirect") flow so a Bitfocus Companion button —
which cannot show a popup — can open the fill page, collect values, fire the action, and
bounce back to Companion. Finally, drop the Bearer token entirely, since this is a
LAN-only personal tool.

Builds on the current preset model (`src/storage/schema.ts`, `src/routes/presets.ts`,
`src/routes/action.ts`, `web/src/components/PresetForm.tsx`).

---

## 1. Template model

- Variables are written `{name}` and are allowed **only** in `title` and `description`.
- Variables are **auto-detected** from the text — no separate declaration list.
- `{name|default}` — an inline default, substituted in place while keeping the sentence
  structure intact.
- `{{` / `}}` — escape sequence for a literal brace.
- Each of `title` and `description` may have an optional **fallback text** — a full
  alternate string used when that field has any unresolved variable. This replaces the
  whole sentence, not just the token.
  - Example: title `أنوار الصحيح الدرس {lesson} - عبد الوهاب`, fallback
    `أنوار الصحيح - عبد الوهاب`. When `lesson` is unresolved, the literal `الدرس ` is
    dropped along with it.
- A preset with no `{...}` behaves exactly as it does today.

## 2. Resolution order (evaluated per field, independently)

For each of title and description:

1. Every variable resolves (supplied value → UI last-used → inline default) → render the
   **primary** text.
2. Any variable unresolved **and** the field has fallback text → render the **fallback**
   text; the field's variables are reported with `source: "fallback"`.
3. Any variable unresolved **and** no fallback text → reject the action with
   `MISSING_TEMPLATE_VARS`, listing the missing variable names.

Title and description never force each other into fallback.

## 3. Storage

- Extend `presetSchema` with optional, nullable `titleFallback` and `descriptionFallback`.
- Variables stay implicit in the text — no new array/field for them.
- The preset export/import format stays backward compatible (new fields optional; existing
  presets and existing backups continue to parse and behave identically).

## 4. Trigger endpoint

- `POST /api/action/preset` and `POST /api/dashboard/action/preset` accept an optional
  `vars` object:

  ```json
  { "presetId": "gaming_main", "vars": { "lesson": "41" } }
  ```

- The response reports how each variable resolved:

  ```json
  {
    "success": true,
    "resolvedVars": [
      { "name": "lesson", "value": "41", "source": "provided" }
    ]
  }
  ```

  `source` ∈ `provided | default | fallback`. Variables in a field that fell back are
  reported with `source: "fallback"`.
- If a required variable is unresolved and its field has no fallback, respond with
  `success: false` and error `MISSING_TEMPLATE_VARS` (HTTP 200, per existing action
  convention), listing the names.

## 5. UI fill popup

- Selecting a preset that **has variables** opens the fill popup. A preset with **no
  variables** fires immediately (unchanged behavior).
- One input per detected variable.
- The inline default / field fallback is shown as **greyed placeholder** text; leaving a
  field blank uses it.
- **Last-used values** are prefilled per preset, stored client-side.
- A **read-only live preview** of the resolved title and description updates as the user
  types, applying the fallback when a field is left empty.
- Submitting fires the action and shows success/error inline.

## 6. Companion redirect (deep-link) flow

- The SPA gains a fill route, e.g. `GET /fill?preset=<id>&redirect=<url>`.
- A Companion button configured with the "redirect" option opens the browser at that URL
  instead of calling the API directly. The fill popup opens with the preset preselected.
- On submit the page fires `POST /api/dashboard/action/preset` (unauthenticated,
  LAN-trust).
  - **On success** → `window.location = redirect` (the Companion URL supplied on the
    button).
  - **On failure** → stay on the page and show the error.
- A preset with **no variables** opened with a redirect fires and bounces immediately
  (no popup).
- The `redirect` target accepts any `http(s)` URL — no allowlist (matches the existing
  LAN-trust model).

## 7. Live state on a Companion button (already supported)

`GET /api/feedback/status` already returns `{ title, privacyStatus, isLive }`, served from
cache with zero YouTube quota. Companion binds/formats these itself. No server change —
documentation/wiring only. Included here for completeness; not a build task.

## 8. Drop Bearer auth (LAN-only)

- Remove `bearerAuth` (`src/auth/bearerMiddleware.ts`), the token routes
  (`/api/dashboard/token`, `src/routes/token.ts`), `src/auth/apiToken.ts`, the
  `tokenRecordSchema` and `token` field in the store, and the token panel in the dashboard
  UI.
- All endpoints are served unauthenticated (full LAN-trust — anything on the LAN can
  trigger; accepted for this personal tool).
- `/api/action` and `/api/dashboard/action` are both unauthenticated and served by the
  **same handler**, split by caller (not legacy): `/api/action/*` is the Companion base,
  `/api/dashboard/action/*` is the dashboard base. Both are intentional and supported.
- The first-run "generate a token" flow disappears.

---

## User stories

1. As the operator, I can put `{variables}` in a preset's title/description and have them
   auto-detected, so I can reuse one preset with different specifics each stream.
2. As the operator, I can give a variable an inline default `{name|default}` so a common
   value fills automatically when I don't override it.
3. As the operator, I can set a whole-sentence fallback per field so that when a variable
   is missing the title/description reads naturally instead of leaving a gap
   (the أنوار الصحيح lesson-number case).
4. As a Companion integrator, I can trigger a templated preset over the endpoint by passing
   a `vars` object, and see from `resolvedVars` exactly what filled and whether a fallback
   was used.
5. As the operator, when I select a templated preset in the dashboard, I get a popup to
   fill the variables, with last-used values prefilled and a live preview before firing.
6. As the operator, plain (variable-less) presets still fire immediately with no extra
   click.
7. As a Companion user, I can press a button that opens the fill page in a browser, fill
   the popup, and be redirected back to Companion on success — working around Companion's
   inability to show a popup.
8. As the operator, I run the tool on my LAN without any Bearer token to configure or
   manage.
