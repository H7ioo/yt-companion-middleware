// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LIVE_ELIGIBILITY_GLOSSARY, type LiveEligibility } from "@app/shared";
import { RidingModeNotice } from "./RidingModeNotice.js";

afterEach(cleanup);

const riding = (over: Partial<LiveEligibility> = {}): LiveEligibility => ({
  mode: "riding",
  reason: "insufficientLivePermissions",
  message: "The user is not enabled for live streaming.",
  checkedAt: "2026-09-03T10:00:00.000Z",
  ...over,
});

describe("RidingModeNotice", () => {
  it("says nothing while the mode is unknown — nothing has been refused", () => {
    const { container } = render(
      <RidingModeNotice
        eligibility={{ mode: "unknown", reason: null, message: null, checkedAt: null }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("says nothing while the app is allowed to create broadcasts", () => {
    const { container } = render(
      <RidingModeNotice
        eligibility={{ mode: "driving", reason: null, message: null, checkedAt: null }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  // The whole point of the notice: an operator who reads "can't create a broadcast" with no
  // subject goes hunting for a setting in this app, and there is no setting. YouTube has to be
  // named as the one refusing, in the words the glossary settled on.
  it("names YouTube as the refuser, in the canonical words", () => {
    render(<RidingModeNotice eligibility={riding()} />);
    const term = LIVE_ELIGIBILITY_GLOSSARY.riding;
    expect(screen.getByText(term.label)).toBeDefined();
    expect(screen.getByText(term.meaning)).toBeDefined();
    expect(term.meaning).toContain("YouTube");
    expect(screen.getByText(term.remedy)).toBeDefined();
  });

  it("shows YouTube's own refusal verbatim as the evidence", () => {
    render(<RidingModeNotice eligibility={riding()} />);
    const evidence = screen.getByRole("group", { name: "What YouTube said" });
    expect(evidence.textContent).toContain("insufficientLivePermissions");
    expect(evidence.textContent).toContain("The user is not enabled for live streaming.");
  });

  it("stays quiet about evidence YouTube did not give", () => {
    render(<RidingModeNotice eligibility={riding({ reason: null, message: null })} />);
    expect(screen.queryByRole("group", { name: "What YouTube said" })).toBeNull();
  });

  // Deliberately not an alert: it is a standing fact about the channel, not something that just
  // went wrong, and an assertive role would interrupt an operator mid-show to say so.
  it("is a status, not an alert", () => {
    render(<RidingModeNotice eligibility={riding()} />);
    expect(screen.getByRole("status")).toBeDefined();
  });
});
