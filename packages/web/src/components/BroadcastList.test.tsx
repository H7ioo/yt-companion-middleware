// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BroadcastListEntry, BroadcastListing, TargetPin } from "../api.js";
import { BroadcastList } from "./BroadcastList.js";

const list = vi.fn<() => Promise<BroadcastListing>>();
const pin = vi.fn<(id: string | null, label: string | null) => Promise<TargetPin | null>>();

vi.mock("../api.js", () => ({
  api: {
    broadcasts: { list: () => list() },
    target: { pin: (id: string | null, label: string | null) => pin(id, label) },
  },
}));

const pinned = (over: Partial<TargetPin> = {}): TargetPin => ({
  id: "b1",
  label: "Friday service",
  pinnedAt: "2026-09-01T18:00:00.000Z",
  ...over,
});

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
  pin.mockReset();
  pin.mockResolvedValue(null);
});
afterEach(cleanup);

describe("BroadcastList", () => {
  it("leads with the verdict, in plain words", async () => {
    list.mockResolvedValue(
      listing({ verdict: "“Friday service” will air. Bound to “OBS key”." }),
    );
    render(<BroadcastList apiEnabled pin={null} onPinned={() => {}} />);
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
    render(<BroadcastList apiEnabled pin={null} onPinned={() => {}} />);

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
    render(<BroadcastList apiEnabled pin={null} onPinned={() => {}} />);

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
    render(<BroadcastList apiEnabled pin={null} onPinned={() => {}} />);

    await screen.findByText("Tonight");
    expect(screen.getAllByText("Competing")).toHaveLength(2);
    expect(screen.queryByText("Will air")).toBeNull();
  });

  it("states what the listing cost, so nobody puts it on a timer unknowingly", async () => {
    list.mockResolvedValue(listing({ quotaUnits: 4 }));
    render(<BroadcastList apiEnabled pin={null} onPinned={() => {}} />);
    expect(await screen.findByText("4 quota units")).toBeTruthy();
  });

  it("asks YouTube for nothing while the API is paused", async () => {
    render(<BroadcastList apiEnabled={false} pin={null} onPinned={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByText(/The YouTube API is paused, so the broadcast list is not being read\./),
      ).toBeTruthy(),
    );
    expect(list).not.toHaveBeenCalled();
  });

  it("asks for nothing before the dashboard state says whether the API is paused", async () => {
    // The switch used to default to "on" while state loaded, so a paused install spent three
    // quota units on every page load — before the state that would have said so arrived.
    render(<BroadcastList apiEnabled={null} pin={null} onPinned={() => {}} />);
    await waitFor(() => expect(screen.getByText("Waiting for the connection…")).toBeTruthy());
    expect(list).not.toHaveBeenCalled();
  });
  it("pins the broadcast the operator picks, so actions land on it", async () => {
    list.mockResolvedValue(
      listing({
        entries: [
          entry({ id: "airs", title: "Tonight", willAir: true }),
          entry({ id: "stray", title: "Leftover" }),
        ],
      }),
    );
    const onPinned = vi.fn();
    render(<BroadcastList apiEnabled pin={null} onPinned={onPinned} />);

    fireEvent.click(await screen.findByRole("radio", { name: /Leftover/ }));

    await waitFor(() => expect(pin).toHaveBeenCalledWith("stray", "Leftover"));
    // The pin lives in dashboard state, which the picker panel reads from too — one concept,
    // surfaced twice, so the list tells the app to re-read rather than keeping its own copy.
    await waitFor(() => expect(onPinned).toHaveBeenCalled());
    // Selecting a target is a state change, not new evidence about the channel: re-reading the
    // listing here would spend three quota units on every pick.
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("shows which row the pin is on, from state rather than from its own memory", async () => {
    list.mockResolvedValue({
      ...listing(),
      entries: [entry({ id: "airs", title: "Tonight" }), entry({ id: "stray", title: "Leftover" })],
    });
    render(<BroadcastList apiEnabled pin={pinned({ id: "stray", label: "Leftover" })} onPinned={() => {}} />);

    const chosen = await screen.findByRole("radio", { name: /Leftover/ });
    expect(chosen.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /Tonight/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("clears the pin from here too, so neither surface owns it", async () => {
    list.mockResolvedValue({ ...listing(), entries: [entry({ id: "stray", title: "Leftover" })] });
    const onPinned = vi.fn();
    render(<BroadcastList apiEnabled pin={pinned({ id: "stray", label: "Leftover" })} onPinned={onPinned} />);

    fireEvent.click(await screen.findByRole("radio", { name: /choose automatically/i }));

    await waitFor(() => expect(pin).toHaveBeenCalledWith(null, null));
    await waitFor(() => expect(onPinned).toHaveBeenCalled());
  });

  it("checks the automatic row when nothing is pinned, so the group always has an answer", async () => {
    list.mockResolvedValue({ ...listing(), entries: [entry({ id: "stray", title: "Leftover" })] });
    render(<BroadcastList apiEnabled pin={null} onPinned={() => {}} />);

    const auto = await screen.findByRole("radio", { name: /choose automatically/i });
    expect(auto.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByRole("radio", { name: /Leftover/ }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("keeps a way back to automatic when the channel lists nothing", async () => {
    // A pin on a deleted broadcast is exactly when the operator needs this row, and it is also
    // when the list has no other rows to offer.
    list.mockResolvedValue(listing({ entries: [] }));
    render(<BroadcastList apiEnabled pin={pinned({ id: "gone", label: "Last week" })} onPinned={() => {}} />);

    const auto = await screen.findByRole("radio", { name: /choose automatically/i });
    expect(auto.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/No upcoming or live broadcasts/)).toBeTruthy();
  });

  it("offers no pinning at all while the API is paused", async () => {
    // The write itself would land, but the state re-read behind it is refused while paused, so
    // the panel would go on showing a pin the server no longer holds.
    render(<BroadcastList apiEnabled={false} pin={pinned()} onPinned={() => {}} />);

    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("says so when the pinned broadcast is not the one that will air", async () => {
    list.mockResolvedValue(
      listing({
        entries: [
          entry({ id: "airs", title: "Tonight", willAir: true }),
          entry({ id: "stray", title: "Leftover" }),
        ],
      }),
    );
    render(<BroadcastList apiEnabled pin={pinned({ id: "stray", label: "Leftover" })} onPinned={() => {}} />);

    const note = await screen.findByRole("status");
    expect(note.textContent).toContain("Leftover");
    expect(note.textContent).toContain("Tonight");
  });

  it("stays quiet when the pin and the airing broadcast agree", async () => {
    list.mockResolvedValue(
      listing({ entries: [entry({ id: "airs", title: "Tonight", willAir: true })] }),
    );
    render(<BroadcastList apiEnabled pin={pinned({ id: "airs", label: "Tonight" })} onPinned={() => {}} />);

    await screen.findByText("Tonight");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("flags a pin on a broadcast the channel no longer lists", async () => {
    list.mockResolvedValue(
      listing({ entries: [entry({ id: "airs", title: "Tonight", willAir: true })] }),
    );
    render(<BroadcastList apiEnabled pin={pinned({ id: "gone", label: "Last week" })} onPinned={() => {}} />);

    const note = await screen.findByRole("status");
    expect(note.textContent).toContain("Last week");
    expect(note.textContent).toMatch(/no longer on the channel|not in this list/i);
  });

  it("says the live broadcast takes the edits, not the pinned one", async () => {
    // The server resolves a live broadcast before it ever reads the pin, so the usual "editing
    // your pick changes nothing viewers see" is exactly backwards here: the edit lands on air.
    list.mockResolvedValue(
      listing({
        entries: [
          entry({ id: "on-air", title: "Tonight", isLive: true, willAir: true }),
          entry({ id: "stray", title: "Leftover" }),
        ],
      }),
    );
    render(<BroadcastList apiEnabled pin={pinned({ id: "stray", label: "Leftover" })} onPinned={() => {}} />);

    const note = await screen.findByRole("status");
    expect(note.textContent).toContain("Tonight");
    expect(note.textContent).toMatch(/on air/i);
    expect(note.textContent).not.toMatch(/will not change what viewers see/);
  });

  it("will not let a live broadcast be picked, because actions already edit it", async () => {
    // Same rule the Edit target panel enforces: while a broadcast is on air, actions go to it
    // whatever is pinned, so offering the pick here would promise something untrue.
    list.mockResolvedValue({
      ...listing(),
      entries: [entry({ id: "on-air", title: "Tonight", isLive: true, willAir: true })],
    });
    render(<BroadcastList apiEnabled pin={null} onPinned={() => {}} />);

    const row = await screen.findByRole("radio", { name: /Tonight/ });
    expect((row as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(row);
    expect(pin).not.toHaveBeenCalled();
  });

  it("keeps the list on screen when the pin write fails, and says why", async () => {
    list.mockResolvedValue({ ...listing(), entries: [entry({ id: "stray", title: "Leftover" })] });
    pin.mockRejectedValue(new Error("Target refused"));
    render(<BroadcastList apiEnabled pin={null} onPinned={() => {}} />);

    fireEvent.click(await screen.findByRole("radio", { name: /Leftover/ }));

    expect(await screen.findByText("Target refused")).toBeTruthy();
    expect(screen.getByText("Leftover")).toBeTruthy();
  });
});
