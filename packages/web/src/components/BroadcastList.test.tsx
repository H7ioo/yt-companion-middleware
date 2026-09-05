// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BroadcastListEntry, BroadcastListing, TargetPin } from "../api.js";
import { BroadcastList, resetBroadcastCache } from "./BroadcastList.js";
import { COPIED_MS } from "../lib/useCopied.js";

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
  // The listing outlives a mount on purpose, so each test starts from a cold session.
  resetBroadcastCache();
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

  it("keeps a way back to automatic when the read itself fails", async () => {
    // Quota exhaustion does not clear the pin, and with the Edit target panel retired this row
    // is the only control that can (issue 072).
    list.mockRejectedValue(new Error("Quota exhausted"));
    const onPinned = vi.fn();
    render(<BroadcastList apiEnabled pin={pinned({ id: "gone", label: "Last week" })} onPinned={onPinned} />);

    expect(await screen.findByText(/Quota exhausted/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /choose automatically/i }));

    await waitFor(() => expect(pin).toHaveBeenCalledWith(null, null));
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
    // While a broadcast is on air, actions go to it whatever is pinned, so offering the pick
    // here would promise something untrue.
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

describe("BroadcastList, managing (issue 069)", () => {
  it("offers no row actions on the Live page's read-only list", async () => {
    list.mockResolvedValue({ ...listing(), entries: [entry({ title: "Tonight" })] });
    render(<BroadcastList apiEnabled pin={null} onPinned={() => {}} />);

    await screen.findByText("Tonight");
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.getByRole("heading", { name: "What will air" })).toBeTruthy();
  });

  it("names itself for the collection it manages, not for tonight's verdict", async () => {
    list.mockResolvedValue({ ...listing(), entries: [entry({ title: "Tonight" })] });
    render(<BroadcastList manage apiEnabled pin={null} onPinned={() => {}} />);

    await screen.findByText("Tonight");
    expect(screen.getByRole("heading", { name: "Broadcasts" })).toBeTruthy();
  });

  it("still leads with the same verdict and the same evidence the Live list shows", async () => {
    list.mockResolvedValue(
      listing({
        verdict: "“Tonight” will air. Bound to “OBS key”.",
        entries: [entry({ title: "Tonight", willAir: true, reason: "Bound to “OBS key”." })],
      }),
    );
    render(<BroadcastList manage apiEnabled pin={null} onPinned={() => {}} />);

    expect(await screen.findByText(/“Tonight” will air\./)).toBeTruthy();
    const row = screen.getByRole("listitem", { name: /Tonight/ });
    expect(row.textContent).toContain("OBS key");
    expect(row.textContent).toContain("Auto-start on");
    expect(row.textContent).toContain("Public");
    expect(row.textContent).toContain("Will air");
    expect(row.textContent).toContain("b1");
  });

  it("copies the watch link of the row it was pressed on", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    list.mockResolvedValue({
      ...listing(),
      entries: [entry({ id: "a", title: "Tonight" }), entry({ id: "b", title: "Leftover" })],
    });
    render(<BroadcastList manage apiEnabled pin={null} onPinned={() => {}} />);

    const row = await screen.findByRole("listitem", { name: /Leftover/ });
    fireEvent.click(within(row).getByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://www.youtube.com/watch?v=b"));
    // Only the row that was pressed reports back — two rows saying "Copied" is a lie about
    // what is on the clipboard.
    expect(within(row).getByRole("button", { name: "Copied" })).toBeTruthy();
    const other = screen.getByRole("listitem", { name: /Tonight/ });
    expect(within(other).getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("hands the button back rather than saying “Copied” for the rest of the session", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    list.mockResolvedValue({ ...listing(), entries: [entry({ id: "a", title: "Tonight" })] });
    render(<BroadcastList manage apiEnabled pin={null} onPinned={() => {}} />);

    const row = await screen.findByRole("listitem", { name: /Tonight/ });
    fireEvent.click(within(row).getByRole("button", { name: "Copy link" }));
    expect(await within(row).findByRole("button", { name: "Copied" })).toBeTruthy();

    // "Copied" is feedback about something that just happened, so it expires. Left standing, it
    // reads as a claim about the clipboard long after anything else has been copied — and the
    // button stops looking pressable for a second copy of the same link.
    await waitFor(
      () => expect(within(row).getByRole("button", { name: "Copy link" })).toBeTruthy(),
      { timeout: COPIED_MS + 1000 },
    );
  });

  it("says so when the clipboard refuses, rather than claiming the link was copied", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockRejectedValue(new Error("no"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    list.mockResolvedValue({ ...listing(), entries: [entry({ id: "a", title: "Tonight" })] });
    render(<BroadcastList manage apiEnabled pin={null} onPinned={() => {}} />);

    fireEvent.click(
      within(await screen.findByRole("listitem", { name: /Tonight/ })).getByRole("button", {
        name: "Copy link",
      }),
    );

    expect(await screen.findByText(/copy it by hand/i)).toBeTruthy();
    // The whole of the recovery: telling someone to copy by hand is useless unless the link is
    // on the screen, and the row shows only the id.
    expect(screen.getByText("https://www.youtube.com/watch?v=a")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("sets the one pin from here too, rather than inventing a second target", async () => {
    list.mockResolvedValue({ ...listing(), entries: [entry({ id: "stray", title: "Leftover" })] });
    const onPinned = vi.fn();
    render(<BroadcastList manage apiEnabled pin={null} onPinned={onPinned} />);

    fireEvent.click(await screen.findByRole("radio", { name: /Leftover/ }));

    await waitFor(() => expect(pin).toHaveBeenCalledWith("stray", "Leftover"));
    await waitFor(() => expect(onPinned).toHaveBeenCalled());
  });

  it("reads the channel on demand here as well, and states what the read cost", async () => {
    list.mockResolvedValue(listing({ quotaUnits: 3 }));
    render(<BroadcastList manage apiEnabled pin={null} onPinned={() => {}} />);

    expect(await screen.findByText("3 quota units")).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("spends no quota on this page either while the API is paused", async () => {
    render(<BroadcastList manage apiEnabled={false} pin={null} onPinned={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText(/The YouTube API is paused/)).toBeTruthy(),
    );
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  });
});

describe("BroadcastList, the session's one read (issue 069)", () => {
  it("does not re-read the channel when the same list is mounted again on the other page", async () => {
    list.mockResolvedValue({ ...listing(), entries: [entry({ title: "Tonight" })] });
    const first = render(<BroadcastList apiEnabled pin={null} onPinned={() => {}} />);
    await screen.findByText("Tonight");
    expect(list).toHaveBeenCalledTimes(1);

    // Live → Broadcasts is a fresh mount of this same panel. Three quota units per navigation is
    // exactly what "read on demand, never polled" rules out.
    first.unmount();
    render(<BroadcastList manage apiEnabled pin={null} onPinned={() => {}} />);

    expect(await screen.findByText("Tonight")).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("still reads again when asked to refresh", async () => {
    list.mockResolvedValue(listing());
    const first = render(<BroadcastList apiEnabled pin={null} onPinned={() => {}} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<BroadcastList manage apiEnabled pin={null} onPinned={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Refresh list" }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});

describe("BroadcastList, without a Clipboard API (issue 069)", () => {
  it("says the link must be copied by hand, rather than doing nothing at all", async () => {
    // Plain HTTP over the LAN is how this app is normally reached, and there the API is absent —
    // not failing, absent.
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    list.mockResolvedValue({ ...listing(), entries: [entry({ id: "a", title: "Tonight" })] });
    render(<BroadcastList manage apiEnabled pin={null} onPinned={() => {}} />);

    fireEvent.click(
      within(await screen.findByRole("listitem", { name: /Tonight/ })).getByRole("button", {
        name: "Copy link",
      }),
    );

    expect(await screen.findByText(/copy it by hand/i)).toBeTruthy();
    expect(screen.getByText("https://www.youtube.com/watch?v=a")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });
});

/**
 * What the retired Edit target panel said that this list did not (issue 072).
 *
 * Deleting a duplicate control is only safe if the sentences it carried alone survive the
 * deletion. Two did: the paused-API line that names the broadcast actions resume onto, and the
 * on-air lede. `Disagreement` already covers the on-air case when a pin points elsewhere — but
 * with no pin at all it says nothing, which is the state most installs sit in.
 */
describe("BroadcastList, what the Edit target panel used to say (issue 072)", () => {
  it("names the broadcast actions will resume onto while the API is paused", () => {
    render(
      <BroadcastList
        apiEnabled={false}
        pin={pinned({ id: "b1", label: "Friday service" })}
        onPinned={() => {}}
      />,
    );

    expect(screen.getByText(/Actions will target “Friday service” once you resume/)).toBeTruthy();
  });

  it("falls back to the pin's id when no label was recorded for it", () => {
    render(
      <BroadcastList apiEnabled={false} pin={pinned({ id: "b7", label: null })} onPinned={() => {}} />,
    );

    expect(screen.getByText(/Actions will target “b7” once you resume/)).toBeTruthy();
  });

  it("says a paused install with no pin will choose automatically, rather than naming nothing", () => {
    render(<BroadcastList apiEnabled={false} pin={null} onPinned={() => {}} />);

    expect(screen.getByText(/choose automatically once you resume/i)).toBeTruthy();
  });

  it("states that edits go to the live broadcast even when nothing is pinned", async () => {
    list.mockResolvedValue(
      listing({ entries: [entry({ id: "on-air", title: "Tonight", isLive: true, willAir: true })] }),
    );
    render(<BroadcastList apiEnabled pin={null} onPinned={() => {}} />);

    expect(
      await screen.findByText(/You are on air.*edits? go to the live broadcast/i),
    ).toBeTruthy();
  });

  it("leaves the on-air lede off when nothing is live", async () => {
    list.mockResolvedValue(listing({ entries: [entry({ id: "b1", title: "Tonight" })] }));
    render(<BroadcastList apiEnabled pin={null} onPinned={() => {}} />);

    await screen.findByText("Tonight");
    expect(screen.queryByText(/You are on air/i)).toBeNull();
  });

  it("does not repeat itself: the on-air lede and the disagreement warning are one message, not two", async () => {
    // Both would otherwise fire on the same render — the lede for the live row, the warning for
    // the pin pointing away from it — and the warning is the more specific of the two.
    list.mockResolvedValue(
      listing({
        entries: [
          entry({ id: "on-air", title: "Tonight", isLive: true, willAir: true }),
          entry({ id: "stray", title: "Leftover" }),
        ],
      }),
    );
    render(
      <BroadcastList apiEnabled pin={pinned({ id: "stray", label: "Leftover" })} onPinned={() => {}} />,
    );

    await screen.findByRole("status");
    expect(screen.queryByText(/You are on air/i)).toBeNull();
  });
});
