import { describe, expect, it } from "vitest";
import { splitLocalInput, joinLocalInput, formatChosenDay, isPastDay, isPastStart, timeZoneHint } from "./dateTimeField.js";
import { localInputToIso } from "./prepareForm.js";

describe("splitLocalInput", () => {
  it("splits a datetime-local value into the day and the time the control edits separately", () => {
    // The calendar owns the day and the time field owns the clock, but the value crossing the
    // form's boundary stays the one string `localInputToIso` already reads.
    const { day, time } = splitLocalInput("2026-09-04T19:00");
    expect(day).toEqual(new Date(2026, 8, 4));
    expect(time).toBe("19:00");
  });
});

describe("joinLocalInput", () => {
  it("puts the two halves back into the value the form sends", () => {
    expect(joinLocalInput(new Date(2026, 8, 4), "19:00")).toBe("2026-09-04T19:00");
  });
});

describe("the value crossing the form boundary", () => {
  it("still round-trips through localInputToIso, so the request body is unchanged", () => {
    // The whole point of splitting the control and not the value: the ISO string the server
    // receives is the one the native input used to produce.
    const { day, time } = splitLocalInput("2026-09-04T19:00");
    const rejoined = joinLocalInput(day, time);
    expect(localInputToIso(rejoined)).toBe(localInputToIso("2026-09-04T19:00"));
    expect(localInputToIso(rejoined)).toBe(new Date(2026, 8, 4, 19, 0).toISOString());
  });

  it("is empty until both halves are answered, so the form keeps refusing", () => {
    // A day with no clock is not midnight — it is a start time the operator has not finished
    // giving. Defaulting it would schedule a service at 00:00 without anyone choosing that.
    expect(joinLocalInput(new Date(2026, 8, 4), "")).toBe("");
    expect(joinLocalInput(null, "19:00")).toBe("");
    expect(splitLocalInput("")).toEqual({ day: null, time: "" });
  });
});

describe("formatChosenDay", () => {
  it("leads with the weekday, because that is what scheduling a service decides", () => {
    // The native control's failing, named in the issue: it never says which day of the week a
    // date falls on. Here the weekday is the first thing read, in the collapsed field too.
    expect(formatChosenDay(new Date(2026, 8, 4))).toBe("Fri 4 Sept 2026");
  });

  it("invites the press when no day is chosen yet", () => {
    expect(formatChosenDay(null)).toBe("Pick a day");
  });
});

describe("isPastDay", () => {
  const now = new Date(2026, 8, 4, 19, 30);

  it("marks a day before today, so the grid can discourage it without refusing it", () => {
    // Retiming to the past is legal in the API and occasionally intended, so the past is dimmed
    // and lit amber, never disabled.
    expect(isPastDay(new Date(2026, 8, 3), now)).toBe(true);
  });

  it("does not mark today, even once the hour it is now has gone by", () => {
    // The grid decides by calendar day. A 19:00 start chosen at 19:30 is a past *start* — the
    // note below the field says so — but today is not a past day.
    expect(isPastDay(new Date(2026, 8, 4), now)).toBe(false);
    expect(isPastDay(new Date(2026, 8, 5), now)).toBe(false);
  });
});

describe("isPastStart", () => {
  const now = new Date(2026, 8, 4, 19, 30);

  it("catches a start earlier today, which the grid cannot show", () => {
    expect(isPastStart("2026-09-04T19:00", now)).toBe(true);
    expect(isPastStart("2026-09-04T20:00", now)).toBe(false);
  });

  it("says nothing about a start that is not finished being given", () => {
    // No day, or no clock: there is nothing to be late for yet, and an amber note over a field
    // the operator is still filling in is an alarm that means nothing.
    expect(isPastStart("", now)).toBe(false);
  });
});

describe("timeZoneHint", () => {
  it("names the clock the times are read against, as the old hint only promised", () => {
    // "Your own clock" told the operator whose clock but never which one. On a hosted install
    // the browser and the server are not in the same place, and the difference is a service
    // scheduled hours out.
    expect(timeZoneHint("Europe/London")).toBe("Your own clock — Europe/London.");
  });

  it("falls back to the promise alone where the browser will not name a zone", () => {
    expect(timeZoneHint(undefined)).toBe("Your own clock.");
  });
});
