// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BroadcastEditView, Category, StreamInfo } from "../api.js";
import { EditBroadcastModal } from "./EditBroadcastModal.js";

const editable = vi.fn<(id: string) => Promise<BroadcastEditView>>();
const edit = vi.fn(async (_id: string, _body: unknown) => ({ id: "b1", quotaUnits: 51 }));

vi.mock("../api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.js")>()),
  api: { broadcasts: { editable: (id: string) => editable(id), edit: (id: string, b: unknown) => edit(id, b) } },
}));

const streams: StreamInfo[] = [
  { id: "s1", title: "OBS key", streamName: "abcd-efgh" },
  { id: "s2", title: "Spare key", streamName: "ijkl-mnop" },
];
const categories: Category[] = [
  { id: "22", title: "People & Blogs" },
  { id: "29", title: "Nonprofits & Activism" },
];

function view(over: Partial<BroadcastEditView> = {}): BroadcastEditView {
  return {
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
    ...over,
  };
}

function mount(onClose: () => void = () => {}, onSaved: () => void = () => {}) {
  return render(
    <EditBroadcastModal
      broadcastId="b1"
      streams={streams}
      categories={categories}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
}

afterEach(() => {
  cleanup();
  editable.mockReset();
  edit.mockClear();
});

describe("EditBroadcastModal", () => {
  it("sends only the field that moved, so an edit does not re-write what nobody touched", async () => {
    editable.mockResolvedValue(view());
    mount();

    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Harvest service" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(edit).toHaveBeenCalledWith("b1", { title: "Harvest service" }));
  });

  it("locks the setup once an encoder has bound, and says why rather than greying in silence", async () => {
    editable.mockResolvedValue(view({ lifeCycleStatus: "testing" }));
    mount();

    const dvr = await screen.findByLabelText(/DVR/);
    expect((dvr as HTMLInputElement).disabled).toBe(true);
    // The reason is on the screen, in the app's own words for the lifecycle.
    expect(screen.getByText(/encoder is bound and previewing/i)).toBeTruthy();
    // And the metadata half stays open — that is the edit an operator needs at 22:58.
    expect((screen.getByLabelText("Title") as HTMLInputElement).disabled).toBe(false);
  });

  it("lets Escape close an open calendar without throwing away the form behind it", async () => {
    editable.mockResolvedValue(view());
    const onClose = vi.fn();
    mount(onClose);

    // Open the start date's calendar, then press Escape. The calendar is what Escape is aimed
    // at; closing the modal too would discard every edit made so far.
    const openers = await screen.findAllByRole("button", { name: /pick a (day|date)|calendar/i });
    fireEvent.click(openers[0]);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the keyboard inside the panel, as a dialog claiming aria-modal has to", async () => {
    editable.mockResolvedValue(view());
    mount();
    await screen.findByLabelText("Title");

    // Focus opens into the dialog rather than being left on whatever opened it.
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    // And Tab off the last stop comes back to the first, rather than wandering into the page
    // behind an overlay a screen reader has been told is modal.
    const save = screen.getByRole("button", { name: /save changes/i });
    save.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("re-reads after a failed save, because the calls before the failure already landed", async () => {
    editable.mockResolvedValue(view());
    const onSaved = vi.fn();
    edit.mockRejectedValueOnce(new Error("Could not rebind the key."));
    mount(() => {}, onSaved);

    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Harvest service" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText(/could not rebind/i)).toBeTruthy());
    // The list re-reads and so does the form: a save that failed on its third call may already
    // have written the first two, and a panel showing the pre-press state invites a second press.
    expect(onSaved).toHaveBeenCalled();
    await waitFor(() => expect(editable).toHaveBeenCalledTimes(2));
  });

  it("closes on Escape when no calendar is open", async () => {
    editable.mockResolvedValue(view());
    const onClose = vi.fn();
    mount(onClose);
    await screen.findByLabelText("Title");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });
});
