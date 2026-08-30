// @vitest-environment jsdom
// Only the web components render React into a DOM; the rest of the repo stays on plain `node`,
// so the environment is declared per-file rather than globally.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BroadcastCandidate } from "../api.js";
import { TargetPicker } from "./TargetPicker.js";

const candidates = vi.fn<() => Promise<BroadcastCandidate[]>>();
const pin = vi.fn<(id: string | null, label: string | null) => Promise<unknown>>();

vi.mock("../api.js", () => ({
  api: {
    target: {
      candidates: () => candidates(),
      pin: (id: string | null, label: string | null) => pin(id, label),
    },
  },
}));

const PINNED_AT = "2026-08-30T10:00:00.000Z";

const candidate = (over: Partial<BroadcastCandidate> = {}): BroadcastCandidate => ({
  id: "b1",
  title: "Friday service",
  scheduledStartTime: null,
  lifeCycleStatus: "ready",
  isLive: false,
  wouldPick: false,
  ...over,
});

beforeEach(() => {
  candidates.mockReset();
  pin.mockReset();
  candidates.mockResolvedValue([]);
  pin.mockResolvedValue(null);
});
afterEach(cleanup);

const props = { pin: null, apiEnabled: true, onChanged: () => {} };

describe("TargetPicker", () => {
  describe("while the YouTube API is paused", () => {
    it("reads nothing from the channel — the switch's whole promise is zero quota", async () => {
      render(<TargetPicker {...props} apiEnabled={false} />);

      await Promise.resolve();
      expect(candidates).not.toHaveBeenCalled();
      expect(screen.queryByRole("radiogroup")).toBeNull();
    });

    it("still says which broadcast actions will land on once the API resumes", () => {
      render(<TargetPicker {...props} apiEnabled={false} pin={{ id: "b1", label: "Friday service", pinnedAt: PINNED_AT }} />);

      expect(screen.getByText(/Actions will target “Friday service” once you resume/)).toBeDefined();
    });

    it("asks the operator to resume when there is no pin to report", () => {
      render(<TargetPicker {...props} apiEnabled={false} />);

      expect(screen.getByText(/Resume it to choose a target/)).toBeDefined();
    });

    it("locks Reload list, since reloading is the call it must not make", () => {
      render(<TargetPicker {...props} apiEnabled={false} />);

      const reload = screen.getByRole("button", { name: "Reload list" });
      expect((reload as HTMLButtonElement).disabled).toBe(true);
      expect(reload.getAttribute("title")).toBe("YouTube API is paused");
    });
  });

  describe("reading the channel", () => {
    it("offers Automatic as a real row, not an absent state", async () => {
      candidates.mockResolvedValue([candidate()]);
      render(<TargetPicker {...props} />);

      const auto = await screen.findByRole("radio", { name: /Choose automatically/ });
      expect(auto.getAttribute("aria-checked")).toBe("true");
    });

    it("shows each candidate's id — the evidence that tells two same-titled events apart", async () => {
      candidates.mockResolvedValue([
        candidate({ id: "b1", title: "Friday service" }),
        candidate({ id: "b2", title: "Friday service" }),
      ]);
      render(<TargetPicker {...props} />);

      expect(await screen.findByText("b1")).toBeDefined();
      expect(screen.getByText("b2")).toBeDefined();
    });

    it("marks the pinned row as the chosen one", async () => {
      candidates.mockResolvedValue([candidate({ id: "b1" }), candidate({ id: "b2", title: "Sunday" })]);
      render(<TargetPicker {...props} pin={{ id: "b2", label: "Sunday", pinnedAt: PINNED_AT }} />);

      // The Automatic row renders immediately, so wait for the candidates themselves to land.
      await screen.findByText("b2");
      const rows = screen.getAllByRole("radio");
      expect(rows.find((r) => r.textContent?.includes("b2"))?.getAttribute("aria-checked")).toBe("true");
      expect(rows.find((r) => r.textContent?.includes("b1"))?.getAttribute("aria-checked")).toBe("false");
    });

    it("says the channel is empty only when the read succeeded and returned nothing", async () => {
      candidates.mockResolvedValue([]);
      render(<TargetPicker {...props} />);

      expect(await screen.findByText(/No broadcasts on the channel/)).toBeDefined();
    });

    it("treats a failed read as no evidence at all, not as an empty channel", async () => {
      candidates.mockRejectedValue(new Error("YouTube unreachable"));
      render(<TargetPicker {...props} />);

      expect(await screen.findByText("YouTube unreachable")).toBeDefined();
      expect(screen.queryByText(/No broadcasts on the channel/)).toBeNull();
      expect(screen.queryByText("Reading the channel…")).toBeNull();
    });

    it("warns when the pinned broadcast is no longer on the channel", async () => {
      candidates.mockResolvedValue([candidate({ id: "b1" })]);
      render(<TargetPicker {...props} pin={{ id: "gone", label: "Deleted event", pinnedAt: PINNED_AT }} />);

      expect(await screen.findByText(/“Deleted event” is no longer on the channel/)).toBeDefined();
    });

    it("does not cry 'gone' before the list has been read", () => {
      render(<TargetPicker {...props} pin={{ id: "gone", label: "Deleted event", pinnedAt: PINNED_AT }} />);

      expect(screen.queryByText(/no longer on the channel/)).toBeNull();
    });
  });

  describe("choosing", () => {
    it("pins the chosen broadcast and tells the rail to follow", async () => {
      candidates.mockResolvedValue([candidate({ id: "b1", title: "Friday service" })]);
      const onChanged = vi.fn();
      render(<TargetPicker {...props} onChanged={onChanged} />);

      fireEvent.click(await screen.findByRole("radio", { name: /Friday service/ }));

      await waitFor(() => expect(pin).toHaveBeenCalledWith("b1", "Friday service"));
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it("clears the pin when Automatic is chosen", async () => {
      candidates.mockResolvedValue([candidate()]);
      render(<TargetPicker {...props} pin={{ id: "b1", label: "Friday service", pinnedAt: PINNED_AT }} />);

      fireEvent.click(await screen.findByRole("radio", { name: /Choose automatically/ }));

      await waitFor(() => expect(pin).toHaveBeenCalledWith(null, null));
    });

    it("refuses to pin away from the broadcast on air", async () => {
      candidates.mockResolvedValue([candidate({ id: "b1", isLive: true })]);
      render(<TargetPicker {...props} />);

      const row = await screen.findByRole("radio", { name: /On air now/ });
      expect((row as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(row);
      expect(pin).not.toHaveBeenCalled();
    });

    it("says so when the pin cannot be saved, and leaves the choice unmade", async () => {
      candidates.mockResolvedValue([candidate({ id: "b1" })]);
      pin.mockRejectedValue(new Error("Server said no"));
      const onChanged = vi.fn();
      render(<TargetPicker {...props} onChanged={onChanged} />);

      fireEvent.click(await screen.findByRole("radio", { name: /Friday service/ }));

      expect(await screen.findByText("Server said no")).toBeDefined();
      expect(onChanged).not.toHaveBeenCalled();
    });

    it("re-reads the list after a successful pin, so a stale row cannot linger", async () => {
      candidates.mockResolvedValue([candidate({ id: "b1" })]);
      render(<TargetPicker {...props} />);

      await screen.findByRole("radio", { name: /Friday service/ });
      expect(candidates).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("radio", { name: /Friday service/ }));
      await waitFor(() => expect(candidates).toHaveBeenCalledTimes(2));
    });
  });

  describe("the lede names the decision the operator is actually making", () => {
    it("says the live broadcast wins while on air", async () => {
      candidates.mockResolvedValue([candidate({ id: "b1", isLive: true })]);
      render(<TargetPicker {...props} />);

      expect(await screen.findByText(/You are on air.*whatever is chosen here/)).toBeDefined();
    });

    it("explains the choice while idle", async () => {
      candidates.mockResolvedValue([candidate()]);
      render(<TargetPicker {...props} />);

      expect(await screen.findByText(/only you can tell them apart/)).toBeDefined();
    });
  });

  describe("each row carries the evidence that separates it from its neighbours", () => {
    it("says when a broadcast is due, and how YouTube sees it", async () => {
      const inTwoHours = new Date(Date.now() + 120 * 60_000).toISOString();
      candidates.mockResolvedValue([
        candidate({ scheduledStartTime: inTwoHours, lifeCycleStatus: "created", wouldPick: true }),
      ]);
      render(<TargetPicker {...props} />);

      const row = await screen.findByRole("radio", { name: /Friday service/ });
      expect(row.textContent).toContain("in 2 h");
      expect(row.textContent).toContain("no encoder yet");
      expect(row.textContent).toContain("the automatic choice");
    });

    it("counts a past start as overdue rather than as a countdown", async () => {
      const anHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
      candidates.mockResolvedValue([candidate({ scheduledStartTime: anHourAgo })]);
      render(<TargetPicker {...props} />);

      const row = await screen.findByRole("radio", { name: /Friday service/ });
      expect(row.textContent).toContain("due 60 min ago");
    });

    it("reads an imminent start as 'about now' rather than as '0 min'", async () => {
      candidates.mockResolvedValue([candidate({ scheduledStartTime: new Date().toISOString() })]);
      render(<TargetPicker {...props} />);

      expect((await screen.findByRole("radio", { name: /Friday service/ })).textContent).toContain(
        "starts about now",
      );
    });

    it("does not render Invalid Date when YouTube hands back a start time it cannot parse", async () => {
      candidates.mockResolvedValue([candidate({ scheduledStartTime: "not-a-date" })]);
      render(<TargetPicker {...props} />);

      const row = await screen.findByRole("radio", { name: /Friday service/ });
      expect(row.textContent).toContain("no start time");
      expect(row.textContent).not.toContain("Invalid Date");
    });

    it("passes through a lifecycle value it has no phrasing for", async () => {
      candidates.mockResolvedValue([candidate({ lifeCycleStatus: "complete" })]);
      render(<TargetPicker {...props} />);

      expect((await screen.findByRole("radio", { name: /Friday service/ })).textContent).toContain(
        "complete",
      );
    });
  });
});
