// @vitest-environment jsdom
// Only the web components render React into a DOM; the rest of the repo stays on plain `node`,
// so the environment is declared per-file rather than globally.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BROADCAST_STATE, HEALTH_GLOSSARY } from "@app/shared";
import type { DashboardState } from "../api.js";
import { StatusRail } from "./StatusRail.js";

afterEach(cleanup);

const PINNED_AT = "2026-08-30T10:00:00.000Z";

const state = (over: Partial<DashboardState> = {}): DashboardState => ({
  status: { broadcastId: "bc1", title: "Friday service", privacyStatus: "unlisted", isLive: false, noTarget: false },
  activePresetId: null,
  displayLabel: "Custom",
  slugPng: null,
  titlePng: null,
  health: "ok",
  liveEligibility: { mode: "unknown", reason: null, message: null, checkedAt: null },
  healthMessage: null,
  lastRefreshedAt: null,
  busy: false,
  quota: { date: "2026-08-30", used: 0, limit: 10000, remaining: 10000 },
  undo: null,
  ingestion: null,
  apiEnabled: true,
  fillRequest: null,
  targetConflict: null,
  targetPin: null,
  ...over,
});

const props = {
  onRefresh: () => {},
  refreshing: false,
  onToggleApi: () => {},
  onOpenSettings: () => {},
  version: null,
  onShowWhatsNew: () => {},
  // No signed-in account: the desktop/LAN default, where authentication is dormant (issue 043).
  account: null,
  onSignOut: () => {},
};

describe("StatusRail", () => {
  describe("before the first state lands", () => {
    it("renders rather than throwing on a null state", () => {
      render(<StatusRail {...props} state={null} />);

      expect(screen.getByRole("heading", { name: "Broadcast Control" })).toBeDefined();
      expect(screen.getByText("No metadata cached yet")).toBeDefined();
      expect(screen.getByText("Awaiting first refresh…")).toBeDefined();
    });

    it("shows the breaker armed and locked, so it never flashes 'Paused' on load", () => {
      render(<StatusRail {...props} state={null} />);

      const breaker = screen.getByRole("switch");
      expect(breaker.getAttribute("aria-checked")).toBe("true");
      // Locked until there is real state to toggle away from.
      expect((breaker as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe("broadcast state", () => {
    it("names the live state from the canonical glossary", () => {
      render(
        <StatusRail {...props} state={state({ status: { broadcastId: "bc1", title: "Friday service", privacyStatus: "public", isLive: true, noTarget: false } })} />,
      );

      expect(screen.getByText(BROADCAST_STATE.live.label)).toBeDefined();
      expect(screen.getByText(BROADCAST_STATE.live.badge)).toBeDefined();
    });

    it("names the idle state from the canonical glossary", () => {
      render(<StatusRail {...props} state={state()} />);

      expect(screen.getByText(BROADCAST_STATE.idle.label)).toBeDefined();
      expect(screen.getByText(BROADCAST_STATE.idle.badge)).toBeDefined();
    });

    it("tells the operator where to go when there is no broadcast at all", () => {
      render(
        <StatusRail {...props} state={state({ status: { broadcastId: null, title: null, privacyStatus: null, isLive: false, noTarget: true } })} />,
      );

      expect(screen.getByText("No broadcast — create or go live on YouTube")).toBeDefined();
    });
  });

  describe("the Target readout says how the target was chosen, not what it is", () => {
    it("reads None when there is no target", () => {
      render(
        <StatusRail {...props} state={state({ status: { broadcastId: null, title: null, privacyStatus: null, isLive: false, noTarget: true } })} />,
      );

      expect(targetReadout()).toBe("None");
    });

    it("reads Live broadcast on air, whatever is pinned", () => {
      render(
        <StatusRail
          {...props}
          state={state({
            status: { broadcastId: "bc1", title: "x", privacyStatus: "public", isLive: true, noTarget: false },
            targetPin: { id: "pin1", label: "Pinned one", pinnedAt: PINNED_AT },
          })}
        />,
      );

      expect(targetReadout()).toBe("Live broadcast");
    });

    it("names the pin while idle", () => {
      render(<StatusRail {...props} state={state({ targetPin: { id: "pin1", label: "Pinned one", pinnedAt: PINNED_AT } })} />);

      expect(targetReadout()).toBe("Pinned one");
    });

    it("falls back to the pin's id when it carries no label", () => {
      render(<StatusRail {...props} state={state({ targetPin: { id: "pin1", label: null, pinnedAt: PINNED_AT } })} />);

      expect(targetReadout()).toBe("pin1");
    });

    it("reads Chosen automatically with no pin", () => {
      render(<StatusRail {...props} state={state()} />);

      expect(targetReadout()).toBe("Chosen automatically");
    });
  });

  describe("health", () => {
    it("lights the lamp with the key colour the glossary assigns the state", () => {
      const cases = [
        ["ok", "lamp--ready"],
        ["degraded", "lamp--warn"],
        ["offline", "lamp--offline"],
        ["auth_error", "lamp--err"],
      ] as const;

      for (const [health, lamp] of cases) {
        const { container, unmount } = render(<StatusRail {...props} state={state({ health })} />);
        expect(container.querySelector(`.health .lamp.${lamp}`), health).not.toBeNull();
        expect(screen.getByText(HEALTH_GLOSSARY[health].label)).toBeDefined();
        unmount();
      }
    });

    it("surfaces the health message when the server sends one", () => {
      render(<StatusRail {...props} state={state({ healthMessage: "Retrying in 30s" })} />);

      expect(screen.getByText("Retrying in 30s")).toBeDefined();
    });
  });

  describe("the API breaker", () => {
    it("reads Live and offers to pause when the API is armed", () => {
      const onToggleApi = vi.fn();
      render(<StatusRail {...props} onToggleApi={onToggleApi} state={state()} />);

      const breaker = screen.getByRole("switch", { name: "Pause YouTube API" });
      expect(breaker.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(breaker);
      expect(onToggleApi).toHaveBeenCalledWith(false);
    });

    it("reads Paused and offers to enable when the API is off", () => {
      const onToggleApi = vi.fn();
      render(<StatusRail {...props} onToggleApi={onToggleApi} state={state({ apiEnabled: false })} />);

      expect(screen.getByText("No calls sent — quota untouched")).toBeDefined();
      fireEvent.click(screen.getByRole("switch", { name: "Enable YouTube API" }));
      expect(onToggleApi).toHaveBeenCalledWith(true);
    });

    it("locks refresh while the API is paused — a refresh is a YouTube call", () => {
      render(<StatusRail {...props} state={state({ apiEnabled: false })} />);

      const refresh = screen.getByRole("button", { name: "Refresh from YouTube" });
      expect((refresh as HTMLButtonElement).disabled).toBe(true);
      expect(refresh.getAttribute("title")).toBe("Enable the YouTube API to refresh");
    });
  });

  describe("quota", () => {
    it("stays green under 75%", () => {
      const { container } = render(
        <StatusRail {...props} state={state({ quota: { date: "d", used: 5000, limit: 10000, remaining: 5000 } })} />,
      );

      expect(container.querySelector(".quota-bar--ok")).not.toBeNull();
      // Built the same way the component does, so the assertion follows the runner's locale
      // instead of hard-coding en-US grouping.
      expect(
        screen.getByText(`${(5000).toLocaleString()} / ${(10000).toLocaleString()}`),
      ).toBeDefined();
    });

    it("warns from 75%", () => {
      const { container } = render(
        <StatusRail {...props} state={state({ quota: { date: "d", used: 7500, limit: 10000, remaining: 2500 } })} />,
      );

      expect(container.querySelector(".quota-bar--warn")).not.toBeNull();
    });

    it("goes red from 90%, before the 403 rather than after it", () => {
      const { container } = render(
        <StatusRail {...props} state={state({ quota: { date: "d", used: 9000, limit: 10000, remaining: 1000 } })} />,
      );

      expect(container.querySelector(".quota-bar--err")).not.toBeNull();
    });

    it("does not divide by a zero limit, and never overfills past 100%", () => {
      const { container, unmount } = render(
        <StatusRail {...props} state={state({ quota: { date: "d", used: 10, limit: 0, remaining: 0 } })} />,
      );
      expect(fillWidth(container)).toBe("0%");
      unmount();

      const over = render(
        <StatusRail {...props} state={state({ quota: { date: "d", used: 30000, limit: 10000, remaining: 0 } })} />,
      );
      expect(fillWidth(over.container)).toBe("100%");
    });
  });

  describe("the build stamp", () => {
    it("is absent on a host that reports no version", () => {
      render(<StatusRail {...props} state={state()} version={null} />);

      expect(screen.queryByText(/^v\d/)).toBeNull();
    });

    it("doubles as the way back into What's New", () => {
      const onShowWhatsNew = vi.fn();
      render(<StatusRail {...props} state={state()} version="2.3.0" onShowWhatsNew={onShowWhatsNew} />);

      fireEvent.click(screen.getByRole("button", { name: "v2.3.0" }));
      expect(onShowWhatsNew).toHaveBeenCalledTimes(1);
    });
  });

  it("opens settings on demand", () => {
    const onOpenSettings = vi.fn();
    render(<StatusRail {...props} state={state()} onOpenSettings={onOpenSettings} />);

    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("refreshes on demand, and locks the button while one is in flight", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<StatusRail {...props} state={state()} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh from YouTube" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(<StatusRail {...props} state={state()} onRefresh={onRefresh} refreshing={true} />);
    const busy = screen.getByRole("button", { name: "Refreshing…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
  });
});

/** The rail's Target row, read the way an operator reads it — by its label. */
function targetReadout(): string {
  const label = screen.getByText("Target");
  return label.parentElement?.querySelector(".readout__value")?.textContent?.trim() ?? "";
}

function fillWidth(container: HTMLElement): string {
  return (container.querySelector(".quota-bar__fill") as HTMLElement).style.width;
}

describe("the signed-in account", () => {
  it("names who is signed in and offers a way out", () => {
    const onSignOut = vi.fn();
    render(
      <StatusRail
        {...props}
        state={state()}
        account={{ id: "a1", name: "operator", role: "admin" }}
        onSignOut={onSignOut}
      />,
    );
    expect(screen.getByText("operator")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("shows no account row on a deployment that does not authenticate", () => {
    render(<StatusRail {...props} state={state()} />);
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
  });
});
