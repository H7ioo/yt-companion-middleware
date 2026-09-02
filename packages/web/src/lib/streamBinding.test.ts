import { describe, expect, it } from "vitest";
import type { StreamInfo } from "../api.js";
import {
  bindingLabel,
  describeBindingChange,
  isStaleBinding,
  streamOptionLabel,
} from "./streamBinding.js";

const stream = (id: string, title: string, streamName: string | null = null): StreamInfo => ({
  id,
  title,
  streamName,
});

const streams = [stream("a", "Main", "key-1"), stream("b", "Backup")];

describe("isStaleBinding", () => {
  it("is false when the id inherits the default (null)", () => {
    expect(isStaleBinding(null, streams)).toBe(false);
  });

  it("is false while the stream list is empty (nothing to check against yet)", () => {
    expect(isStaleBinding("z", [])).toBe(false);
  });

  it("is false when the bound id matches a live stream", () => {
    expect(isStaleBinding("a", streams)).toBe(false);
  });

  it("is true when the bound id is missing from a non-empty list", () => {
    expect(isStaleBinding("z", streams)).toBe(true);
  });
});

describe("streamOptionLabel", () => {
  it("joins title and streamName with an em dash", () => {
    expect(streamOptionLabel(stream("a", "Main", "key-1"))).toBe("Main — key-1");
  });

  it("shows only the title when streamName is absent", () => {
    expect(streamOptionLabel(stream("b", "Backup"))).toBe("Backup");
  });
});

describe("bindingLabel", () => {
  it("names an unset binding in words rather than as an empty string", () => {
    expect(bindingLabel(null, streams)).toBe("not set");
  });

  it("names a known stream the way the picker does", () => {
    expect(bindingLabel("a", streams)).toBe("Main — key-1");
  });

  it("names an id no live stream carries, and says so", () => {
    expect(bindingLabel("z", streams)).toBe("id z (not a live stream)");
  });

  it("names an id plainly while the stream list is still empty", () => {
    expect(bindingLabel("z", [])).toBe("id z");
  });
});

describe("describeBindingChange", () => {
  it("is null when nothing is changing", () => {
    expect(describeBindingChange("a", "a", streams)).toBeNull();
    expect(describeBindingChange(null, null, streams)).toBeNull();
  });

  it("names both sides of a change between two live streams", () => {
    expect(describeBindingChange("a", "b", streams)).toEqual({
      from: "Main — key-1",
      to: "Backup",
      clearing: false,
    });
  });

  it("flags clearing the binding, which is a change like any other", () => {
    expect(describeBindingChange("a", null, streams)).toEqual({
      from: "Main — key-1",
      to: "not set",
      clearing: true,
    });
  });

  it("describes setting a binding that was never set", () => {
    expect(describeBindingChange(null, "b", streams)).toEqual({
      from: "not set",
      to: "Backup",
      clearing: false,
    });
  });
});
