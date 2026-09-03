/**
 * The small conversions the prepare form turns on (issue 062), kept out of the component so the
 * one that can be wrong by hours is testable.
 */

/**
 * A `datetime-local` value as an instant.
 *
 * `new Date("2026-09-04T19:00")` is already local-time in every current browser, but the same
 * string with a `Z` or an offset is not, and the difference is a service scheduled hours away
 * from when the operator said. The parts are read explicitly so the reading cannot drift.
 */
export function localInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, min] = m.map(Number) as unknown as number[];
  const at = new Date(y, mo - 1, d, h, min);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** The inverse, for showing a scheduled time back in the operator's own clock. */
export function isoToLocalInput(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(
    at.getHours(),
  )}:${pad(at.getMinutes())}`;
}

/**
 * What a preparation costs, stated where the operator decides to spend it (PRD-16 §2 asks for
 * this in the UI or the guide; the button is where the question is actually asked).
 */
export function describePrepareCost(withCategory: boolean): string {
  return withCategory
    ? "Costs 151 of the day's 10,000 quota units — create, bind, and set the category."
    : "Costs 100 of the day's 10,000 quota units — create and bind.";
}
