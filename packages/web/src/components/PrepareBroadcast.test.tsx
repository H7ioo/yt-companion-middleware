// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LiveEligibility, PreparedBroadcast, Preset, StreamInfo } from "../api.js";
import { PrepareBroadcast } from "./PrepareBroadcast.js";

const prepare = vi.fn();
const preparedList = vi.fn<() => Promise<PreparedBroadcast[]>>();

vi.mock("../api.js", () => ({
  api: {
    broadcasts: {
      prepare: (input: unknown) => prepare(input),
      prepared: () => preparedList(),
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
    <PrepareBroadcast
      presets={[preset()]}
      streams={streams}
      categories={[{ id: "24", title: "Entertainment" }]}
      apiEnabled
      eligibility={driving}
      onPrepared={() => {}}
      {...over}
    />,
  );
}

beforeEach(() => {
  prepare.mockReset();
  prepare.mockResolvedValue({ prepared: made(), quotaUnits: 100 });
  preparedList.mockReset();
  preparedList.mockResolvedValue([]);
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
});
