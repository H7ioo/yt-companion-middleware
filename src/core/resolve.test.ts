import { describe, expect, it } from "vitest";
import { resolve, presetToPayload, type BroadcastResource } from "./resolve.js";
import type { DefaultSettings, Preset } from "../storage/schema.js";

const defaults: DefaultSettings = {
  defaultCategory: "20",
  defaultStreamBoundId: "default-stream",
};

function baseBroadcast(): BroadcastResource {
  return {
    id: "vid123",
    snippet: {
      title: "Old title",
      description: "Old desc",
      // A field the app must never touch (PRD §6).
      thumbnails: { default: { url: "https://x/y.jpg" } },
    },
    status: { privacyStatus: "private", lifeCycleStatus: "ready" },
    contentDetails: { boundStreamId: "existing-stream" },
  };
}

describe("resolve (PRD §3.3)", () => {
  it("overlays title/description/privacy from the payload", () => {
    const plan = resolve(
      baseBroadcast(),
      { title: "New", description: "Fresh", privacyStatus: "public" },
      defaults,
    );
    expect(plan.broadcast.snippet?.title).toBe("New");
    expect(plan.broadcast.snippet?.description).toBe("Fresh");
    expect(plan.broadcast.status?.privacyStatus).toBe("public");
  });

  it("passes through un-owned fields unchanged (thumbnail)", () => {
    const plan = resolve(baseBroadcast(), { title: "New" }, defaults);
    expect((plan.broadcast.snippet as { thumbnails?: unknown }).thumbnails).toEqual({
      default: { url: "https://x/y.jpg" },
    });
  });

  it("does not mutate the input GET object", () => {
    const input = baseBroadcast();
    resolve(input, { title: "New" }, defaults);
    expect(input.snippet?.title).toBe("Old title");
  });

  it("uses app default for category when preset omits it", () => {
    const plan = resolve(baseBroadcast(), { title: "New", category: null }, defaults);
    expect(plan.categoryId).toBe("20");
  });

  it("preset category override wins over the default", () => {
    const plan = resolve(baseBroadcast(), { title: "New", category: "24" }, defaults);
    expect(plan.categoryId).toBe("24");
  });

  it("uses app default for stream binding when preset omits it", () => {
    const plan = resolve(baseBroadcast(), { title: "New" }, defaults);
    expect(plan.streamBoundId).toBe("default-stream");
  });

  it("leaves category/stream untouched when neither preset nor default set", () => {
    const plan = resolve(baseBroadcast(), { title: "New" }, {
      defaultCategory: null,
      defaultStreamBoundId: null,
    });
    expect(plan.categoryId).toBeNull();
    expect(plan.streamBoundId).toBeNull();
  });
});

describe("presetToPayload", () => {
  it("maps a preset into a metadata payload", () => {
    const preset: Preset = {
      id: "p1",
      title: "Gaming",
      slug: "",
      description: "d",
      privacyStatus: "public",
      category: null,
      streamBoundId: "s1",
      titleFallback: null,
      descriptionFallback: null,
    };
    expect(presetToPayload(preset)).toEqual({
      title: "Gaming",
      description: "d",
      privacyStatus: "public",
      category: null,
      streamBoundId: "s1",
    });
  });
});
