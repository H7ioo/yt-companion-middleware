import { describe, expect, it } from "vitest";
import { describeRetireReason, deleteConfirmation, subjectOf } from "./retire.js";
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
    const text = deleteConfirmation(subjectOf(RECORD));
    expect(text.question).toContain("Friday night");
  });

  it("warns that a shared link breaks, because that is the harm the press cannot undo", () => {
    const { warning } = deleteConfirmation(subjectOf(RECORD));
    expect(warning).toMatch(/link/i);
    expect(warning).toContain(RECORD.watchUrl);
  });

  it("says the link is public when the broadcast is, and does not when it is private", () => {
    expect(deleteConfirmation(subjectOf(RECORD)).warning).toMatch(/anyone/i);
    expect(
      deleteConfirmation(subjectOf({ ...RECORD, privacyStatus: "private" })).warning,
    ).not.toMatch(/anyone/i);
  });

  // Issue 071: deleting is offered on any row of the Broadcasts page, and for the rows this app
  // did not make the warning must not pretend to knowledge it does not have.
  it("says plainly that it did not create this one, and claims nothing about the link's reach", () => {
    const { question, warning } = deleteConfirmation({
      title: "Parish AGM",
      watchUrl: "https://www.youtube.com/watch?v=studio1",
      privacyStatus: "public",
      appCreated: false,
    });
    expect(question).toContain("Parish AGM");
    expect(warning).toMatch(/did not create/i);
    expect(warning).not.toMatch(/anyone who already has it/i);
    expect(warning).toContain("https://www.youtube.com/watch?v=studio1");
  });

  // The same restraint whatever the privacy value says: privacy is about who may watch it now,
  // not about who was handed the link before this app ever saw the broadcast.
  it("does not soften that for a private broadcast it did not create", () => {
    const { warning } = deleteConfirmation({
      title: "Parish AGM",
      watchUrl: "https://www.youtube.com/watch?v=studio1",
      privacyStatus: "private",
      appCreated: false,
    });
    expect(warning).toMatch(/did not create/i);
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
