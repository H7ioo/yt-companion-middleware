## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

(Optional enhancement) Surface action errors on a Companion key (PRD-07 §6, #18). Today the module
logs `error.code`/`message` only to its log panel; add a **`lastError` Companion variable**
(code + message of the most recent failed action) so an operator can bind it to button text for
on-stream debugging (e.g. `INVALID_PRESET`, `MISSING_TEMPLATE_VARS`). Module bump; document how
errors surface.

## Acceptance criteria

- [x] New `lastError` variable exposes the latest failed action's code + message.
- [x] `companion:bump` (minor) in the same PR; documented in the guide/HELP.
- [x] Guide explains: log panel by default, `lastError` variable if bound.

## Done

Added a `last_error` Companion variable ("code + message" of the most recent failed action). A new
pure `formatLastError` helper (transform.js, unit-tested) formats the middleware error envelope as
`CODE: message`, falling back to whichever half is present. Wired into `postAction`: both the
`{success:false}` rejection branch and the transport-failure `catch` set `last_error`. Initialised
blank at `init` and never cleared by a state frame, so the last failure stays visible on a bound
key. `companion:bump minor` → **1.3.0** (package.json + manifest.json). Documented in HELP.md and
README.md (log panel by default, bind `last_error` for on-stream debugging).

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-07 §6 (#18).
