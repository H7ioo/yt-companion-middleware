## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Replace the browser's `datetime-local` control in the Prepare form with a real date picker.

The native control is inconsistent across browsers, awkward to type into, and gives no sense of
which day of the week a date falls on — which is the thing being decided when scheduling a service
or a show.

**Use `react-day-picker`.** Note what this is: the first UI dependency in `@app/web`, which today
runs on `react`, `react-dom` and `react-router` and nothing else. Keep it the only one — pull in
the picker, not a component library around it.

`react-day-picker` is date-only, so the control is a calendar plus a separate time field. Both
feed the existing `localInputToIso` conversion; the ISO string crossing the API boundary does not
change, and neither does the server.

Style it to the app's own language — the panel surfaces, the lamp colours, the mono numerals — not
the library's default stylesheet dropped in as-is. A picker that looks imported is how an app
starts looking assembled rather than made.

## Acceptance criteria

- [x] `react-day-picker` is added to `@app/web` dependencies, pinned, and is the only new package.
- [x] The Prepare form's start time is chosen with a calendar plus a time field.
- [x] The selection still round-trips through `localInputToIso`, and the request body is unchanged.
- [x] The operator's own timezone is used and shown, as the current hint promises.
- [x] Past dates are reachable but visibly discouraged — retiming to the past is legal in the API
      and occasionally intended.
- [x] The control is operable by keyboard alone, and the day cells are labelled for screen readers.
- [x] The picker's styling uses the app's existing tokens; the library's default stylesheet is not
      shipped verbatim.
- [ ] (for issue 070) The same control is used by the edit form's scheduled-time field once issue 070 lands, rather
      than a second implementation.

## Blocked by

Nothing. Issue 070 should reuse this control rather than build its own.

## User stories addressed

- User story 2

## Done — 2026-09-06

Shipped as `DateTimeField` (`packages/web/src/components/DateTimeField.tsx`) over
`react-day-picker` **10.0.1**, pinned exactly. v10 rather than v9: the same API, two fewer
transitive dependencies (v9 also pulls `date-fns-jalali` and a Hijri converter). The one direct
dependency brings `date-fns` and `@date-fns/tz` with it — three packages in the lockfile, one
in `@app/web`'s manifest.

**The value never changed shape.** The control edits a day and a clock separately but still hands
the form the one `datetime-local` string, so `localInputToIso`, the request body and the server
are untouched. A test asserts the ISO round-trip explicitly.

Two things worth knowing for issue 070, which reuses this control:

- **A half-answered start cannot be expressed in the value.** A day chosen before a time joins to
  `""`, so the control holds the unjoinable half in its own state — without that the choice
  vanished on the parent's re-render and the press appeared to do nothing. A test covers it.
- **The past is a remark, not a refusal.** Past days take the rack's amber and stay pressable,
  because retiming into the past is legal in the API. `isPastDay` decides by calendar day for the
  grid; `isPastStart` catches a start earlier *today*, which no cell can show.

The label is deliberately not `htmlFor` the disclosure button: a label pointing at a button
replaces the button's own text as its accessible name, so a screen reader would have heard
"Starts" and never the date.

Not done here: the last criterion belongs to issue 070, which should import `DateTimeField`
rather than build a second control.
