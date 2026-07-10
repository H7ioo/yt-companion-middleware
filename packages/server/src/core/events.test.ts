import { describe, expect, it, vi } from "vitest";
import { StateEvents } from "./events.js";

describe("StateEvents", () => {
  it("delivers emitChange to a subscriber", () => {
    const events = new StateEvents();
    const listener = vi.fn();
    events.onChange(listener);
    events.emitChange();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops delivery after the returned unsubscribe is called", () => {
    const events = new StateEvents();
    const listener = vi.fn();
    const unsubscribe = events.onChange(listener);
    events.emitChange();
    unsubscribe();
    events.emitChange();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("fans a single change out to every subscriber", () => {
    const events = new StateEvents();
    const a = vi.fn();
    const b = vi.fn();
    events.onChange(a);
    events.onChange(b);
    events.emitChange();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
