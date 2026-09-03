import { describe, expect, it } from "vitest";
import { describeRetireReason, deleteConfirmation } from "./retire.js";
import type { PreparedBroadcast } from "./schema.js";

const RECORD: PreparedBroadcast = {
  id: "abc123",
  title: "Friday night",
  privacyStatus: "public",
  scheduledStartTime: "2026-09-04T18:00:00.000Z",
  streamId: "stream-9",
  watchUrl: "https://www.youtube.com/watch?v=abc123",
  createdAt: "2026-09-03T10:00:00.000Z",
  presetId: null,
  airedAt: null,
  retiredAt: null,
  retiredReason: null,
};

describe("deleteConfirmation", () => {
  it("names the broadcast, so the operator confirms this one and not 'a broadcast'", () => {
    const text = deleteConfirmation(RECORD);
    expect(text.question).toContain("Friday night");
  });

  it("warns that a shared link breaks, because that is the harm the press cannot undo", () => {
    const { warning } = deleteConfirmation(RECORD);
    expect(warning).toMatch(/link/i);
    expect(warning).toContain(RECORD.watchUrl);
  });

  it("says the link is public when the broadcast is, and does not when it is private", () => {
    expect(deleteConfirmation(RECORD).warning).toMatch(/anyone/i);
    expect(deleteConfirmation({ ...RECORD, privacyStatus: "private" }).warning).not.toMatch(/anyone/i);
  });
});

describe("describeRetireReason", () => {
  it("says it was created here and never aired — the two facts that made it a candidate", () => {
    const reason = describeRetireReason(RECORD.scheduledStartTime);
    expect(reason).toMatch(/never/i);
    expect(reason).toContain("2026-09-04");
  });

  it("copes with a record that has no scheduled start", () => {
    expect(describeRetireReason(null)).toMatch(/never/i);
  });
});
