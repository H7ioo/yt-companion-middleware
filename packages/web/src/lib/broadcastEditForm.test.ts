import { describe, expect, it } from "vitest";
import { describeEditCost, editDiff, formFrom, type EditFormValues } from "./broadcastEditForm.js";
import type { BroadcastEditView } from "../api.js";

const view: BroadcastEditView = {
  id: "b1",
  title: "Sunday service",
  description: "the usual",
  scheduledStartTime: "2026-09-06T18:00:00.000Z",
  scheduledEndTime: null,
  privacyStatus: "public",
  lifeCycleStatus: "ready",
  boundStreamId: "s1",
  category: "22",
  enableAutoStart: true,
  enableAutoStop: true,
  enableDvr: true,
  enableClosedCaptions: false,
  enableEmbed: true,
  recordFromStart: true,
  enableMonitorStream: true,
  quotaUnits: 2,
};

/**
 * The form as it opens: whatever YouTube has, in the operator's own clock. Built through
 * `formFrom` rather than typed out, because a hand-written local timestamp is only right in the
 * timezone it was written in — and the diff's whole job is to compare instants, not strings.
 */
function form(over: Partial<EditFormValues> = {}): EditFormValues {
  return { ...formFrom(view), ...over };
}

describe("editDiff", () => {
  it("carries only what the operator actually changed", () => {
    const diff = editDiff(view, form({ title: "Harvest service" }));
    expect(diff).toEqual({ title: "Harvest service" });
  });

  it("is empty when nothing moved, so the form can refuse a press that writes nothing", () => {
    expect(editDiff(view, form())).toEqual({});
  });
});

describe("describeEditCost", () => {
  it("names the read the whole resource has to be re-sent from", () => {
    expect(describeEditCost({ title: "Harvest service" })).toContain("51");
  });

  it("adds the category's own read and write, because it is a second resource", () => {
    expect(describeEditCost({ category: "29" })).toContain("52");
  });
});
