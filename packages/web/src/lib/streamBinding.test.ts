import { describe, expect, it } from "vitest";
import type { StreamInfo } from "../api.js";
import { isStaleBinding, streamOptionLabel } from "./streamBinding.js";

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
