// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { LiveEligibility, PreparedBroadcast, Preset, StreamInfo } from "../api.js";
import { PrepareBroadcast } from "./PrepareBroadcast.js";
import { ApiError } from "../api.js";
import { isoToLocalInput } from "../lib/prepareForm.js";

const prepare = vi.fn();
const preparedList = vi.fn<() => Promise<PreparedBroadcast[]>>();
// Typed off the API surface rather than inferred from the empty default, so a test that resolves
// it with real records is not fighting an inferred `never[]`.
type RetireResult = Awaited<ReturnType<typeof import("../api.js").api.broadcasts.retire>>;
const retire = vi.fn<() => Promise<RetireResult>>(async () => ({
  retired: [],
  aired: [],
  gone: [],
  failed: [],
  quotaUnits: 0,
}));
const deletePrepared = vi.fn(async (_id: string) => ({ retired: made(), quotaUnits: 50 }));

vi.mock("../api.js", async (importOriginal) => ({
  // Partial: ApiError is a real class the panel narrows refusals with, so the mock keeps it
  // rather than replacing it with something `instanceof` can never match (issue 064).
  ...(await importOriginal<typeof import("../api.js")>()),
  api: {
    broadcasts: {
      prepare: (input: unknown) => prepare(input),
      prepared: () => preparedList(),
      retire: () => retire(),
      deletePrepared: (id: string) => deletePrepared(id),
    },
  },
}));

const preset = (over: Partial<Preset> = {}): Preset => ({
  id: "friday",
  title: "Friday service",
  slug: "FRI",
  description: "Doors at 7",
  privacyStatus: "unlisted",
  category: null,
  streamBoundId: "stream-A",
  titleFallback: null,
  descriptionFallback: null,
  ...over,
});

const streams: StreamInfo[] = [{ id: "stream-A", title: "OBS key", streamName: "abcd-efgh" }];

const made = (over: Partial<PreparedBroadcast> = {}): PreparedBroadcast => ({
  id: "made-1",
  title: "Friday service",
  privacyStatus: "unlisted",
  scheduledStartTime: "2026-09-04T18:00:00.000Z",
  streamId: "stream-A",
  watchUrl: "https://www.youtube.com/watch?v=made-1",
  createdAt: "2026-09-03T10:00:00.000Z",
  presetId: "friday",
  airedAt: null,
  retiredAt: null,
  retiredReason: null,
  ...over,
});

const driving: LiveEligibility = {
  mode: "driving",
  reason: null,
  message: null,
  checkedAt: "2026-09-01T00:00:00.000Z",
};

function mount(over: Partial<Parameters<typeof PrepareBroadcast>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PrepareBroadcast
        presets={[preset()]}
        streams={streams}
        categories={[{ id: "24", title: "Entertainment" }]}
        apiEnabled
        eligibility={driving}
        defaultCategory={null}
        onPrepared={() => {}}
        {...over}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  prepare.mockReset();
  prepare.mockResolvedValue({ prepared: made(), quotaUnits: 100, warning: null });
  preparedList.mockReset();
  preparedList.mockResolvedValue([]);
  retire.mockReset();
  retire.mockResolvedValue({ retired: [], aired: [], gone: [], failed: [], quotaUnits: 0 });
  deletePrepared.mockReset();
  deletePrepared.mockResolvedValue({ retired: made(), quotaUnits: 50 });
});
afterEach(cleanup);

describe("PrepareBroadcast", () => {
  it("will not create anything until it has a title and a start time", async () => {
    mount();
    const button = (await screen.findByRole("button", {
      name: "Create broadcast",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("From preset"), { target: { value: "friday" } });
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Starts"), {
      target: { value: "2026-09-04T19:00" },
    });
    expect(button.disabled).toBe(false);
  });

  it("sends the preset and the operator's own start time", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("From preset"), {
      target: { value: "friday" },
    });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-04T19:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create broadcast" }));

    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    expect(prepare.mock.calls[0][0]).toMatchObject({
      presetId: "friday",
      scheduledStartTime: new Date(2026, 8, 4, 19, 0).toISOString(),
    });
  });

  it("shows the share link the moment the broadcast exists", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("From preset"), {
      target: { value: "friday" },
    });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-04T19:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create broadcast" }));

    expect(await screen.findByText("https://www.youtube.com/watch?v=made-1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("hands off to the Broadcasts page once the broadcast exists (issue 069)", async () => {
    // Schedule makes one and stops there. Everything done to a broadcast afterwards — retiming,
    // retitling, deleting — lives on the page that owns the collection.
    mount();
    fireEvent.change(await screen.findByLabelText("From preset"), {
      target: { value: "friday" },
    });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-04T19:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create broadcast" }));

    const link = await screen.findByRole("link", { name: /Broadcasts/ });
    expect(link.getAttribute("href")).toBe("/broadcasts");
  });

  it("opens on public — an untouched field must not put a service out unlisted (issue 074)", async () => {
    mount();
    const privacy = (await screen.findByLabelText("Privacy")) as HTMLSelectElement;
    expect(privacy.value).toBe("public");
  });

  it("still follows a preset's own privacy over the default (issue 074)", async () => {
    // The default is only what applies when nobody recorded a decision. The preset recorded one.
    mount();
    fireEvent.change(await screen.findByLabelText("From preset"), { target: { value: "friday" } });
    expect((screen.getByLabelText("Privacy") as HTMLSelectElement).value).toBe("unlisted");
  });

  it("says the broadcast will follow the encoder, before the press rather than after", async () => {
    mount();
    expect(
      await screen.findByText(/starts when OBS starts, and ends when OBS stops/i),
    ).toBeTruthy();
  });

  it("states what a preparation costs, where the decision is made", async () => {
    mount();
    expect(await screen.findByText(/100 of the day's 10,000/)).toBeTruthy();
  });

  it("reports a refusal in the app's own words rather than failing silently", async () => {
    prepare.mockRejectedValue(new Error("YouTube will not let this channel create broadcasts."));
    mount();
    fireEvent.change(await screen.findByLabelText("From preset"), {
      target: { value: "friday" },
    });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-04T19:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create broadcast" }));

    expect(
      await screen.findByText("YouTube will not let this channel create broadcasts."),
    ).toBeTruthy();
  });

  // Issue 064: a channel too full to take another broadcast is the one refusal here the operator
  // fixes with a press rather than a decision, so the press is offered next to the explanation.
  it("offers the cleanup when YouTube says the channel is full", async () => {
    prepare.mockRejectedValue(
      new ApiError("The channel already holds as many as it allows. Delete the ones you are not going to use.", "BROADCAST_LIMIT_REACHED"),
    );
    retire.mockResolvedValue({ retired: [made()], aired: [], gone: [], failed: [], quotaUnits: 51 });
    mount();
    fireEvent.change(await screen.findByLabelText("From preset"), { target: { value: "friday" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-04T19:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create broadcast" }));

    fireEvent.click(await screen.findByRole("button", { name: "Clear old broadcasts" }));
    await waitFor(() => expect(retire).toHaveBeenCalled());
  });

  it("says so plainly when the cleanup finds nothing of ours to remove", async () => {
    prepare.mockRejectedValue(new ApiError("The channel is full.", "BROADCAST_LIMIT_REACHED"));
    mount();
    fireEvent.change(await screen.findByLabelText("From preset"), { target: { value: "friday" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-04T19:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create broadcast" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear old broadcasts" }));

    // The broadcasts filling the channel are someone else's, and this app will never touch them.
    expect(await screen.findByText(/YouTube Studio/)).toBeTruthy();
  });

  it("offers no creation controls in riding mode — the press would only ever fail", async () => {
    mount({
      eligibility: {
        mode: "riding",
        reason: "livePermissionBlocked",
        message: "The user is not enabled for live streaming.",
        checkedAt: "2026-09-01T00:00:00.000Z",
      },
    });
    await waitFor(() => expect(preparedList).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Create broadcast" })).toBeNull();
    expect(screen.getByText(/will not let this channel create broadcasts/)).toBeTruthy();
  });

  it("refuses to spend two writes while the YouTube API is paused", async () => {
    mount({ apiEnabled: false });
    fireEvent.change(await screen.findByLabelText("From preset"), {
      target: { value: "friday" },
    });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-04T19:00" } });
    expect(
      (screen.getByRole("button", { name: "Create broadcast" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("lists what was prepared earlier, each with its own link to copy", async () => {
    preparedList.mockResolvedValue([made({ id: "old-1", title: "Last Friday" })]);
    mount();
    expect(await screen.findByText("Last Friday")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Copy link" })).toHaveLength(1);
  });

  it("counts an inherited category into the stated cost, not just a chosen one", async () => {
    mount({ defaultCategory: "24" });
    // The operator picked nothing, but the app default still costs the read and the write.
    expect(await screen.findByText(/151 of the day's 10,000/)).toBeTruthy();
  });

  describe("a templated preset", () => {
    const templated = preset({ title: "Service — {topic}", description: "Doors at 7" });

    it("asks for the variables and shows the title as it will actually be created", async () => {
      mount({ presets: [templated] });
      fireEvent.change(await screen.findByLabelText("From preset"), {
        target: { value: "friday" },
      });
      fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-04T19:00" } });

      // Unanswered, the raw template is not offered as the title, and nothing may be created.
      expect(
        (screen.getByRole("button", { name: "Create broadcast" }) as HTMLButtonElement).disabled,
      ).toBe(true);

      fireEvent.change(screen.getByLabelText("topic"), { target: { value: "Harvest" } });
      expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Service — Harvest");
      expect(
        (screen.getByRole("button", { name: "Create broadcast" }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    it("sends the values, so the broadcast is not created under the fallback text", async () => {
      mount({ presets: [templated] });
      fireEvent.change(await screen.findByLabelText("From preset"), {
        target: { value: "friday" },
      });
      fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-04T19:00" } });
      fireEvent.change(screen.getByLabelText("topic"), { target: { value: "Harvest" } });
      fireEvent.click(screen.getByRole("button", { name: "Create broadcast" }));

      await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
      expect(prepare.mock.calls[0][0].vars).toEqual({ topic: "Harvest" });
    });
  });

  describe("once the broadcast exists", () => {
    async function create() {
      fireEvent.change(await screen.findByLabelText("From preset"), {
        target: { value: "friday" },
      });
      fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-09-04T19:00" } });
      fireEvent.click(screen.getByRole("button", { name: "Create broadcast" }));
    }

    it("shows what the broadcast was created with, not only its title and link", async () => {
      // What an operator checks at a glance before sending the link to a hundred people.
      mount();
      await create();
      await screen.findByText("https://www.youtube.com/watch?v=made-1");

      const details = screen.getByTestId("prep-made-details").textContent ?? "";
      expect(details).toContain(isoToLocalInput("2026-09-04T18:00:00.000Z").replace("T", ", "));
      expect(details).toContain("unlisted");
      expect(details).toContain("OBS key — abcd-efgh");
    });

    it("says what did not land, next to the link that did", async () => {
      prepare.mockResolvedValue({
        prepared: made({ streamId: null }),
        quotaUnits: 100,
        warning: "The broadcast exists, but the ingestion key could not be bound to it.",
      });
      mount();
      await create();

      expect(await screen.findByText("https://www.youtube.com/watch?v=made-1")).toBeTruthy();
      expect(screen.getByText(/could not be bound/)).toBeTruthy();
      // A half-finished preparation is the headline, not a footnote beside a tidy details line.
      expect(screen.queryByTestId("prep-made-details")).toBeNull();
    });

    it("still shows the link when the list refresh fails — the broadcast was made either way", async () => {
      preparedList.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("network"));
      const onPrepared = vi.fn();
      mount({ onPrepared });
      await create();

      expect(await screen.findByText("https://www.youtube.com/watch?v=made-1")).toBeTruthy();
      expect(screen.queryByText("Could not create the broadcast.")).toBeNull();
      await waitFor(() => expect(onPrepared).toHaveBeenCalled());
    });

    it("says “Copied” only on the link that was actually copied", async () => {
      const writeText = vi.fn(async () => {});
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      preparedList.mockResolvedValue([
        made({
          id: "old-1",
          title: "Last Friday",
          watchUrl: "https://www.youtube.com/watch?v=old-1",
        }),
      ]);
      mount();
      await create();
      await screen.findByText("https://www.youtube.com/watch?v=made-1");

      // Two links stand: the fresh one in the strip, and the earlier one in the list below.
      const buttons = await screen.findAllByRole("button", { name: "Copy link" });
      expect(buttons).toHaveLength(2);
      fireEvent.click(buttons[1]);

      await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
      // The fresh link's button still offers to copy — it is not what is on the clipboard.
      expect(screen.getAllByRole("button", { name: "Copy link" })).toHaveLength(1);
      expect(writeText).toHaveBeenCalledWith("https://www.youtube.com/watch?v=old-1");
    });
  });
});
