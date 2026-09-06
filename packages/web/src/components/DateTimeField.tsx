import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import {
  browserTimeZone,
  formatChosenDay,
  isPastDay,
  isPastStart,
  joinLocalInput,
  splitLocalInput,
  type Parts,
  timeZoneHint,
} from "../lib/dateTimeField.js";
import { useEscape } from "../lib/useEscape.js";

interface Props {
  id: string;
  label: string;
  /** A `datetime-local` value — the same string the native control produced (issue 075). */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/**
 * **Choosing when a broadcast starts** (issue 075).
 *
 * Replaces the browser's `datetime-local`, which is a different control in every browser, awkward
 * to type into, and silent about the one thing being decided — which day of the week the show
 * falls on. Here the weekday leads, collapsed and in the grid both.
 *
 * The control is a calendar plus a clock, because `react-day-picker` is date-only; the value it
 * hands back is still the single `datetime-local` string, so `localInputToIso` and the request
 * body are untouched.
 *
 * **The past is dimmed, never disabled.** Retiming to a start that has gone by is legal in the
 * API and occasionally intended, so a past day takes the rack's amber — the colour this app
 * already uses for degraded, not for forbidden — and says so beneath the field. Amber is a
 * remark; a disabled cell would be a refusal, and the operator would have to leave for Studio.
 */
export function DateTimeField({ id, label, value, onChange, disabled = false }: Props) {
  const given = useMemo(() => splitLocalInput(value), [value]);
  /**
   * The half the value cannot carry.
   *
   * A day chosen before a time joins to `""` — there is no start time yet — so a control that
   * read only `value` would throw the choice away and the press would appear to do nothing. The
   * given value still wins the moment it carries a half; the draft only fills the gap.
   */
  const [draft, setDraft] = useState<Parts>(given);
  const day = given.day ?? draft.day;
  const time = given.time !== "" ? given.time : draft.time;
  const [open, setOpen] = useState(false);
  /** The month on screen, so reopening returns to the chosen day rather than to this month. */
  const [month, setMonth] = useState<Date>(day ?? new Date());
  const gridId = useId();
  const toggle = useRef<HTMLButtonElement>(null);

  // Evaluated per render rather than held: a form left open across midnight would otherwise go on
  // calling yesterday "today".
  const now = new Date();
  const zone = useMemo(() => timeZoneHint(browserTimeZone()), []);

  useEffect(() => {
    if (given.day) setMonth(given.day);
  }, [value]);

  // Escape closes the calendar and returns the operator to the control they opened it from,
  // which is the only thing that could have taken the focus.
  useEscape(() => {
    if (!open) return;
    setOpen(false);
    toggle.current?.focus();
  });

  function pickDay(next: Date | undefined) {
    if (!next) return;
    setDraft({ day: next, time });
    setMonth(next);
    onChange(joinLocalInput(next, time));
    setOpen(false);
    toggle.current?.focus();
  }

  const past = isPastStart(value, now);

  return (
    <div className="field dtf">
      {/* Deliberately not `htmlFor` the button: a label pointing at a button *replaces* the
          button's own text as its accessible name, so a screen reader would hear "Starts" and
          never the date. Referenced instead, alongside the button's own content. */}
      <label id={`${id}-label`}>{label}</label>

      <div className="dtf__row">
        <button
          type="button"
          id={id}
          ref={toggle}
          className={`dtf__day${day ? "" : " dtf__day--empty"}`}
          disabled={disabled}
          aria-labelledby={`${id}-label ${id}`}
          aria-expanded={open}
          aria-controls={open ? gridId : undefined}
          onClick={() => setOpen((was) => !was)}
        >
          <span className="dtf__day-text">{formatChosenDay(day)}</span>
          <span className="dtf__caret" aria-hidden="true" />
        </button>

        <input
          type="time"
          className="dtf__time mono"
          aria-label={`${label} — time of day`}
          value={time}
          disabled={disabled}
          onChange={(e) => {
            setDraft({ day, time: e.target.value });
            onChange(joinLocalInput(day, e.target.value));
          }}
        />
      </div>

      {open ? (
        <div className="dtf__cal" id={gridId}>
          <DayPicker
            mode="single"
            selected={day ?? undefined}
            onSelect={pickDay}
            month={month}
            onMonthChange={setMonth}
            showOutsideDays
            weekStartsOn={1}
            // The rack's own vocabulary applied to a grid: amber for a day that has gone by,
            // a green tick under today. Nothing here is disabled.
            modifiers={{ past: (d: Date) => isPastDay(d, now) }}
            modifiersClassNames={{ past: "dtf__d--past" }}
            classNames={CAL}
          />
        </div>
      ) : null}

      {/* One line, one job: the zone the times are read against. The past remark replaces it
          rather than stacking under it — an operator reading two hints reads neither. */}
      {past ? (
        <span className="field-warn dtf__past">That start has already gone by.</span>
      ) : day && time === "" ? (
        <span className="hint">Add a start time.</span>
      ) : (
        <span className="hint">{zone}</span>
      )}
    </div>
  );
}

/**
 * The library's elements mapped onto this app's own classes. Its stylesheet is not imported —
 * every rule the calendar draws with lives in `styles.css` beside the panels it sits in.
 */
const CAL = {
  root: "dtf__root",
  months: "dtf__months",
  month: "dtf__month",
  month_caption: "dtf__caption",
  caption_label: "dtf__caption-label",
  nav: "dtf__nav",
  button_previous: "dtf__nav-btn",
  button_next: "dtf__nav-btn",
  chevron: "dtf__chevron",
  month_grid: "dtf__grid",
  weekdays: "dtf__weekdays",
  weekday: "dtf__weekday",
  weeks: "dtf__weeks",
  week: "dtf__week",
  day: "dtf__d",
  day_button: "dtf__d-btn",
  today: "dtf__d--today",
  selected: "dtf__d--selected",
  outside: "dtf__d--outside",
  focused: "dtf__d--focused",
};
