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

- [ ] `react-day-picker` is added to `@app/web` dependencies, pinned, and is the only new package.
- [ ] The Prepare form's start time is chosen with a calendar plus a time field.
- [ ] The selection still round-trips through `localInputToIso`, and the request body is unchanged.
- [ ] The operator's own timezone is used and shown, as the current hint promises.
- [ ] Past dates are reachable but visibly discouraged — retiming to the past is legal in the API
      and occasionally intended.
- [ ] The control is operable by keyboard alone, and the day cells are labelled for screen readers.
- [ ] The picker's styling uses the app's existing tokens; the library's default stylesheet is not
      shipped verbatim.
- [ ] The same control is used by the edit form's scheduled-time field once issue 070 lands, rather
      than a second implementation.

## Blocked by

Nothing. Issue 070 should reuse this control rather than build its own.

## User stories addressed

- User story 2
