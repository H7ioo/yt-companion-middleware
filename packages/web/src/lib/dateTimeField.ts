/**
 * The date-and-time control's own arithmetic (issue 075), kept out of the component so the part
 * that can be wrong by a day is testable without a calendar on screen.
 *
 * The control edits a day and a clock separately, but the value it hands the form is still the
 * one `datetime-local` string `localInputToIso` has always read. Nothing downstream — not the
 * form, not the request body, not the server — knows the picker changed.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** The day and the clock, as the calendar and the time field each want them. */
export interface Parts {
  day: Date | null;
  time: string;
}

/** Reads a `YYYY-MM-DDTHH:mm` value into the two halves the control edits. */
export function splitLocalInput(value: string): Parts {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return { day: null, time: "" };
  const [, y, mo, d, h, min] = m;
  return { day: new Date(Number(y), Number(mo) - 1, Number(d)), time: `${h}:${min}` };
}

/** Puts them back together. Either half missing means there is no start time yet, not midnight. */
export function joinLocalInput(day: Date | null, time: string): string {
  if (!day || !/^\d{2}:\d{2}/.test(time)) return "";
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${time.slice(0, 5)}`;
}

/**
 * The chosen day, weekday first.
 *
 * The weekday leads because it is the thing being decided when a service or a show is scheduled —
 * and it is precisely what the native `datetime-local` control never says. Fixed to `en-GB` so
 * the collapsed field reads the same as the calendar's own weekday headers beneath it.
 */
export function formatChosenDay(day: Date | null): string {
  if (!day) return "Pick a day";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(day)
    .replace(/,/g, "");
}

/**
 * A day earlier than the one it is now — the calendar's `past` modifier.
 *
 * Compared by calendar day, not by instant: the grid colours whole cells, and today is not a
 * past day at 19:30 merely because most of it has gone. Whether the *start* has already passed
 * is a finer question, answered by `isPastStart`.
 */
export function isPastDay(day: Date, now: Date): boolean {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(day.getFullYear(), day.getMonth(), day.getDate()) < midnight;
}

/**
 * Whether the start the operator has given has already gone by.
 *
 * The note this drives is a remark, not a refusal — YouTube accepts a start time in the past, and
 * an operator retiming a show that already began means it.
 */
export function isPastStart(value: string, now: Date): boolean {
  const { day, time } = splitLocalInput(value);
  if (!day || time === "") return false;
  const [h, min] = time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, min) < now;
}

/** The zone the control reads against. Takes the name so a test does not depend on the machine. */
export function timeZoneHint(zone: string | undefined): string {
  return zone ? `Your own clock — ${zone}.` : "Your own clock.";
}

/** What the browser says the operator's zone is, where it will say. */
export function browserTimeZone(): string | undefined {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
}
