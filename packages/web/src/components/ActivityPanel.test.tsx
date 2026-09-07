// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { LogEntry } from "../api.js";
import { ActivityPanel } from "./ActivityPanel.js";

const logs = vi.fn<() => Promise<LogEntry[]>>();

vi.mock("../api.js", () => ({ api: { logs: () => logs() } }));

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  ts: "2026-09-01T18:00:00.000Z",
  level: "info",
  category: "action",
  code: null,
  message: "Title pushed to “Friday service”",
  ...over,
});

beforeEach(() => {
  logs.mockReset();
  logs.mockResolvedValue([]);
});
afterEach(cleanup);

describe("ActivityPanel, first paint (issue 073)", () => {
  it("stands skeleton rows in while the first read is on its way", async () => {
    let settle!: (rows: LogEntry[]) => void;
    logs.mockReturnValue(new Promise<LogEntry[]>((r) => (settle = r)));
    const { container } = render(<ActivityPanel />);

    await waitFor(() => expect(container.querySelectorAll(".skel__row").length).toBe(4));
    expect(screen.getByText("Reading the activity feed…")).toBeTruthy();

    settle([entry()]);

    expect(await screen.findByText(/Title pushed/)).toBeTruthy();
    expect(container.querySelector(".skel__row")).toBeNull();
  });

  it("says the feed is empty once it has been read, rather than pretending to load", async () => {
    const { container } = render(<ActivityPanel />);

    expect(await screen.findByText(/Nothing yet\./)).toBeTruthy();
    expect(container.querySelector(".skel__row")).toBeNull();
  });

  it("replaces the skeleton with the failure rather than animating forever", async () => {
    logs.mockRejectedValue(new Error("offline"));
    const { container } = render(<ActivityPanel />);

    expect(await screen.findByText(/Couldn’t reach the activity feed/)).toBeTruthy();
    expect(container.querySelector(".skel__row")).toBeNull();
  });
});
