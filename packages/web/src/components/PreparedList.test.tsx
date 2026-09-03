// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PreparedBroadcast } from "../api.js";
import { PreparedList } from "./PreparedList.js";

/**
 * The record of what this app made, and the one control that removes it (issue 064).
 *
 * Deleting is the panel's only irreversible press: it breaks a link that is already out in the
 * world. So the question names the broadcast and shows the link that stops working, and the
 * removed rows stay in the list rather than vanishing — a cleanup nobody can see afterwards is
 * indistinguishable from a broadcast that went missing.
 */

const made = (over: Partial<PreparedBroadcast> = {}): PreparedBroadcast => ({
  id: "ours-1",
  title: "Friday night",
  privacyStatus: "public",
  scheduledStartTime: "2026-09-04T18:00:00.000Z",
  streamId: "stream-9",
  watchUrl: "https://www.youtube.com/watch?v=ours-1",
  createdAt: "2026-09-03T10:00:00.000Z",
  presetId: null,
  airedAt: null,
  retiredAt: null,
  retiredReason: null,
  ...over,
});

const onDelete = vi.fn(async () => {});
const onCopy = vi.fn();

afterEach(() => {
  cleanup();
  onDelete.mockReset();
  onCopy.mockReset();
});

const renderList = (items: PreparedBroadcast[]) =>
  render(<PreparedList items={items} copiedUrl={null} onCopy={onCopy} onDelete={onDelete} />);

describe("PreparedList (issue 064)", () => {
  it("shows nothing at all when this app has made nothing", () => {
    const { container } = renderList([]);
    expect(container.innerHTML).toBe("");
  });

  it("asks before deleting, naming the broadcast and the link that stops working", async () => {
    renderList([made()]);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Friday night");
    expect(dialog.textContent).toContain("https://www.youtube.com/watch?v=ours-1");
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("deletes only after the question is answered", async () => {
    renderList([made()]);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete from YouTube" }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("ours-1"));
  });

  it("leaves the broadcast alone when the question is cancelled", async () => {
    renderList([made()]);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep it" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the question on Escape without deleting", async () => {
    renderList([made()]);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("keeps a removed broadcast in the list, saying what happened to it", () => {
    renderList([
      made({
        retiredAt: "2026-09-06T08:00:00.000Z",
        retiredReason: "Created here, never went to air, and its start time has passed.",
      }),
    ]);

    expect(screen.getByText(/never went to air/i)).toBeTruthy();
    // Nothing to copy and nothing to delete: the link is dead and the broadcast is gone.
    expect(screen.queryByRole("button", { name: /copy link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
  });

  it("offers no delete for one that has already aired, and says it aired", () => {
    renderList([made({ airedAt: "2026-09-04T18:00:30.000Z" })]);

    expect(screen.getByText(/aired/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
    // The link still works — a recording people may still be watching.
    expect(screen.getByRole("button", { name: /copy link/i })).toBeTruthy();
  });

  it("copies the link on request", () => {
    renderList([made()]);
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    expect(onCopy).toHaveBeenCalledWith("https://www.youtube.com/watch?v=ours-1");
  });
});
