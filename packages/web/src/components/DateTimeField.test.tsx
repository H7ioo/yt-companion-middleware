// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DateTimeField } from "./DateTimeField.js";

afterEach(cleanup);

describe("DateTimeField", () => {
  it("shows the chosen start as a weekday and a clock, without opening anything", () => {
    // Collapsed, the field answers the question the native control never did: which day of the
    // week is this. The operator reads it without pressing.
    render(<DateTimeField id="start" label="Starts" value="2026-09-04T19:00" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Fri 4 Sept 2026/ })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/time/i).value).toBe("19:00");
  });

  it("keeps the time when a new day is chosen from the calendar", () => {
    // The two halves are edited independently. Choosing a day must not quietly reset the clock —
    // that is the retiming mistake the operator would only find on air.
    const onChange = vi.fn();
    render(<DateTimeField id="start" label="Starts" value="2026-09-04T19:00" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Fri 4 Sept 2026/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Friday, September 11th, 2026$/ }));
    expect(onChange).toHaveBeenCalledWith("2026-09-11T19:00");
  });

  it("keeps the day when the time is retyped", () => {
    const onChange = vi.fn();
    render(<DateTimeField id="start" label="Starts" value="2026-09-04T19:00" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/time of day/i), { target: { value: "20:30" } });
    expect(onChange).toHaveBeenCalledWith("2026-09-04T20:30");
  });

  it("lets a past day be chosen, and says so rather than refusing it", () => {
    // Retiming into the past is legal in the API and occasionally intended. The cell is lit
    // amber and the note remarks on it; nothing is disabled, or the operator has to leave for
    // Studio to do a thing this form can do.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 6, 12, 0));
    const onChange = vi.fn();
    render(<DateTimeField id="start" label="Starts" value="2026-09-06T19:00" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Sun 6 Sept 2026/ }));

    const yesterday = screen.getByRole("button", { name: /^Saturday, September 5th, 2026$/ });
    expect(yesterday.hasAttribute("disabled")).toBe(false);
    expect(yesterday.closest("td")?.className).toContain("dtf__d--past");

    fireEvent.click(yesterday);
    expect(onChange).toHaveBeenCalledWith("2026-09-05T19:00");
    vi.useRealTimers();
  });

  it("remarks on a start earlier today, which no calendar cell can show", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 6, 19, 30));
    render(<DateTimeField id="start" label="Starts" value="2026-09-06T19:00" onChange={vi.fn()} />);
    expect(screen.getByText("That start has already gone by.")).toBeTruthy();
    vi.useRealTimers();
  });

  it("names the zone the times are read against while the start is still in front of us", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 6, 12, 0));
    render(<DateTimeField id="start" label="Starts" value="2026-09-06T19:00" onChange={vi.fn()} />);
    expect(screen.getByText(/Your own clock/)).toBeTruthy();
    expect(screen.queryByText("That start has already gone by.")).toBeNull();
    vi.useRealTimers();
  });

  it("closes on Escape and hands focus back to the control that opened it", () => {
    render(<DateTimeField id="start" label="Starts" value="2026-09-04T19:00" onChange={vi.fn()} />);
    const toggle = screen.getByRole("button", { name: /Fri 4 Sept 2026/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Focus left on a calendar that no longer exists strands a keyboard operator at the top of
    // the document, several tab stops from where they were.
    expect(document.activeElement).toBe(toggle);
  });

  it("refuses both halves while the form is busy", () => {
    render(
      <DateTimeField id="start" label="Starts" value="2026-09-04T19:00" onChange={vi.fn()} disabled />,
    );
    expect(screen.getByRole("button", { name: /Fri 4 Sept 2026/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>(/time of day/i).disabled).toBe(true);
  });

  it("invites the missing half rather than leaving the press dead with no reason", () => {
    // A day with no clock produces no value, so Create stays disabled. Saying which half is
    // missing is the difference between a form that is broken and one that is unfinished.
    render(<DateTimeField id="start" label="Starts" value="" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Pick a day/ })).toBeTruthy();
  });

  it("asks for the clock once a day is chosen but the time is not", () => {
    render(<DateTimeField id="start" label="Starts" value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Pick a day/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /^\w+day, / })[0]);
    // The parent re-renders with the joined value, which is still "" — so the control has to
    // remember the day it was just given, or the press appears to do nothing.
    expect(screen.getByText("Add a start time.")).toBeTruthy();
  });

  it("closes on the chosen day being pressed again, rather than swallowing the press", () => {
    // The library reads a second press on the selected day as a deselect. Read as agreement:
    // the day stands and the calendar closes, or the operator is left with an open grid, no
    // focus, and no way to tell what their press did.
    const onChange = vi.fn();
    render(<DateTimeField id="start" label="Starts" value="2026-09-04T19:00" onChange={onChange} />);
    const toggle = screen.getByRole("button", { name: /Fri 4 Sept 2026/ });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /^Friday, September 4th, 2026, selected$/ }));

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByRole("button", { name: /Fri 4 Sept 2026/ })).toBeTruthy();
  });

  it("stays on the month being browsed while the time is edited", () => {
    // The clock and the calendar are edited side by side. Snapping back to the chosen day's
    // month on every value change would move the grid out from under the operator mid-browse.
    render(<DateTimeField id="start" label="Starts" value="2026-09-04T19:00" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Fri 4 Sept 2026/ }));
    fireEvent.click(screen.getByRole("button", { name: /next month/i }));
    expect(screen.getByText(/October 2026/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/time of day/i), { target: { value: "20:30" } });
    expect(screen.getByText(/October 2026/)).toBeTruthy();
  });

  it("forgets both halves when the parent clears the value", () => {
    // The draft only fills a half the value cannot carry. A parent that resets the form means
    // it, and a stale day left on screen would be a start the operator never chose.
    const { rerender } = render(
      <DateTimeField id="start" label="Starts" value="2026-09-04T19:00" onChange={vi.fn()} />,
    );
    rerender(<DateTimeField id="start" label="Starts" value="" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Pick a day/ })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/time of day/i).value).toBe("");
  });

  it("moves through the grid on the arrow keys, so the calendar needs no mouse", () => {
    const onChange = vi.fn();
    render(<DateTimeField id="start" label="Starts" value="2026-09-04T19:00" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Fri 4 Sept 2026/ }));

    const selected = screen.getByRole("button", { name: /^Friday, September 4th, 2026, selected$/ });
    selected.focus();
    fireEvent.focus(selected);
    fireEvent.keyDown(selected, { key: "ArrowRight" });

    const next = screen.getByRole("button", { name: /^Saturday, September 5th, 2026$/ });
    expect(document.activeElement).toBe(next);
    // Each cell is a real button, so Enter and Space commit it the way the browser already
    // commits any button — there is no key handling of our own to get wrong.
    fireEvent.click(next);
    expect(onChange).toHaveBeenCalledWith("2026-09-05T19:00");
  });
});
