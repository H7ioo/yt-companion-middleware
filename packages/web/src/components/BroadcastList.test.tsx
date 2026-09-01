// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { BroadcastListEntry, BroadcastListing } from "../api.js";
import { BroadcastList } from "./BroadcastList.js";

const list = vi.fn<() => Promise<BroadcastListing>>();

vi.mock("../api.js", () => ({
  api: { broadcasts: { list: () => list() } },
}));

const entry = (over: Partial<BroadcastListEntry> = {}): BroadcastListEntry => ({
  id: "b1",
  title: "Friday service",
  scheduledStartTime: null,
  privacyStatus: "public",
  lifeCycleStatus: "ready",
  boundStreamId: "stream-A",
  boundStreamTitle: "OBS key",
  autoStart: true,
  isLive: false,
  willAir: false,
  reason: "",
  ...over,
});

const listing = (over: Partial<BroadcastListing> = {}): BroadcastListing => ({
  entries: [],
  verdict: "Nothing will air on its own.",
  contested: false,
  encoderStreamId: "stream-A",
  encoderStreamTitle: "OBS key",
  encoderSource: "setting",
  quotaUnits: 3,
  ...over,
});

beforeEach(() => {
  list.mockReset();
  list.mockResolvedValue(listing());
});
afterEach(cleanup);

describe("BroadcastList", () => {
  it("leads with the verdict, in plain words", async () => {
    list.mockResolvedValue(
      listing({ verdict: "“Friday service” will air. Bound to “OBS key”." }),
    );
    render(<BroadcastList apiEnabled />);
    expect(
      await screen.findByText(/“Friday service” will air\. Bound to “OBS key”\./),
    ).toBeTruthy();
  });

  it("marks exactly the row that will air, and says so in the row itself", async () => {
    list.mockResolvedValue(
      listing({
        entries: [
          entry({ id: "airs", title: "Tonight", willAir: true, reason: "Bound to “OBS key”." }),
          entry({ id: "stray", title: "Leftover", reason: "Not attached to any ingestion key." }),
        ],
      }),
    );
    render(<BroadcastList apiEnabled />);

    await screen.findByText("Tonight");
    expect(screen.getAllByText("Will air")).toHaveLength(1);
    const marked = screen.getByRole("listitem", { name: /Tonight/ });
    expect(marked.textContent).toContain("Bound to “OBS key”.");
  });

  it("shows the evidence the decision is made from — key, auto-start and privacy", async () => {
    list.mockResolvedValue({
      ...listing(),
      entries: [entry({ title: "Tonight", autoStart: false, privacyStatus: "unlisted" })],
    });
    render(<BroadcastList apiEnabled />);

    const row = await screen.findByRole("listitem", { name: /Tonight/ });
    expect(row.textContent).toContain("OBS key");
    expect(row.textContent).toContain("Auto-start off");
    expect(row.textContent).toContain("Unlisted");
  });

  it("flags both when two compete, rather than showing one winner", async () => {
    list.mockResolvedValue(
      listing({
        contested: true,
        verdict: "2 broadcasts are attached to “OBS key” with auto-start on.",
        entries: [
          entry({ id: "a", title: "Tonight", willAir: true, reason: "Competing." }),
          entry({ id: "b", title: "Leftover", willAir: true, reason: "Competing." }),
        ],
      }),
    );
    render(<BroadcastList apiEnabled />);

    await screen.findByText("Tonight");
    expect(screen.getAllByText("Competing")).toHaveLength(2);
    expect(screen.queryByText("Will air")).toBeNull();
  });

  it("states what the listing cost, so nobody puts it on a timer unknowingly", async () => {
    list.mockResolvedValue(listing({ quotaUnits: 4 }));
    render(<BroadcastList apiEnabled />);
    expect(await screen.findByText("4 quota units")).toBeTruthy();
  });

  it("asks YouTube for nothing while the API is paused", async () => {
    render(<BroadcastList apiEnabled={false} />);
    await waitFor(() =>
      expect(
        screen.getByText(/The YouTube API is paused, so the broadcast list is not being read\./),
      ).toBeTruthy(),
    );
    expect(list).not.toHaveBeenCalled();
  });
});
