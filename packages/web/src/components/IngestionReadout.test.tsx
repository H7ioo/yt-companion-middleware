// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IngestionReadout as Readout, IngestionReport } from "../api.js";
import { IngestionReadout } from "./IngestionReadout.js";

const read = vi.fn<() => Promise<IngestionReport>>();

vi.mock("../api.js", () => ({ api: { ingestion: { read: () => read() } } }));

const readout = (over: Partial<Readout> = {}): Readout => ({
  streamId: "S1",
  streamTitle: "OBS key",
  streamStatus: "active",
  healthStatus: "good",
  issues: [],
  checkedAt: new Date().toISOString(),
  state: "receiving",
  label: "Receiving video",
  meaning: "YouTube is getting the encoder's video on this key right now.",
  remedy: "Nothing to do — the encoder is through.",
  ...over,
});

beforeEach(() => {
  read.mockReset();
  read.mockResolvedValue({ readout: readout(), unavailable: null, quotaUnits: 1 });
});
afterEach(cleanup);

describe("IngestionReadout", () => {
  it("states what YouTube is seeing, and on which key", () => {
    render(<IngestionReadout apiEnabled ingestion={readout()} />);
    expect(screen.getByText("Receiving video")).toBeTruthy();
    expect(screen.getByText(/OBS key/)).toBeTruthy();
  });

  it("gives the three states different lamps, so they read apart at a glance", () => {
    const lampOf = (state: Readout["state"]) => {
      cleanup();
      const { container } = render(
        <IngestionReadout apiEnabled ingestion={readout({ state })} />,
      );
      return container.querySelector(".feed__lamp")?.className ?? "";
    };
    const lamps = [lampOf("receiving"), lampOf("problems"), lampOf("no-data")];
    expect(new Set(lamps).size).toBe(3);
  });

  it("shows YouTube's own complaint when video is arriving badly — the actionable half", () => {
    render(
      <IngestionReadout
        apiEnabled
        ingestion={readout({
          state: "problems",
          label: "Arriving with problems",
          issues: [
            { severity: "warning", reason: "variableBitrate", description: "Your bitrate varies." },
          ],
        })}
      />,
    );
    expect(screen.getByText("Your bitrate varies.")).toBeTruthy();
  });

  it("says when the reading was taken, because an old answer is not a current one", () => {
    render(
      <IngestionReadout
        apiEnabled
        ingestion={readout({ checkedAt: new Date(Date.now() - 20 * 60_000).toISOString() })}
      />,
    );
    // Old enough to matter: the panel must not present it as what is happening now.
    expect(screen.getByText(/20 minutes ago/)).toBeTruthy();
  });

  it("invites a check when nothing has been read yet, rather than showing an empty box", () => {
    render(<IngestionReadout apiEnabled ingestion={null} />);
    expect(screen.getByText(/Nothing read yet/i)).toBeTruthy();
  });

  it("checks on demand and states the quota it costs", async () => {
    render(<IngestionReadout apiEnabled ingestion={null} />);
    const button = screen.getByRole("button", { name: /check now/i });
    expect(button.getAttribute("title")).toMatch(/1 quota unit/i);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText("Receiving video")).toBeTruthy());
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("prints the server's explanation when there is no key to ask about", async () => {
    read.mockResolvedValue({
      readout: null,
      unavailable: "No default ingestion key is set. Pick the key OBS pushes to in Settings.",
      quotaUnits: 0,
    });
    render(<IngestionReadout apiEnabled ingestion={null} />);
    fireEvent.click(screen.getByRole("button", { name: /check now/i }));
    await waitFor(() => expect(screen.getByText(/Pick the key OBS pushes to/)).toBeTruthy());
  });

  it("spends nothing while the API switch is off, and says so", () => {
    render(<IngestionReadout apiEnabled={false} ingestion={null} />);
    expect(screen.getByRole("button", { name: /check now/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/switched off/i)).toBeTruthy();
  });
});

describe("IngestionReadout freshness", () => {
  it("keeps the newer reading when a push and an on-demand check disagree", async () => {
    // The poll loop's reading is a minute old; the operator presses Check now and gets a newer one.
    const pushed = readout({
      state: "no-data",
      label: "Nothing arriving",
      checkedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    read.mockResolvedValue({ readout: readout(), unavailable: null, quotaUnits: 1 });
    const { rerender } = render(<IngestionReadout apiEnabled ingestion={pushed} />);
    fireEvent.click(screen.getByRole("button", { name: /check now/i }));
    await waitFor(() => expect(screen.getByText("Receiving video")).toBeTruthy());
    // A late push still carrying the old reading must not undo what the check just learned.
    rerender(<IngestionReadout apiEnabled ingestion={pushed} />);
    expect(screen.getByText("Receiving video")).toBeTruthy();
  });
});
