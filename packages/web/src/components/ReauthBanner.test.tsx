// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SetupStatus } from "../api.js";
import { ReauthBanner } from "./ReauthBanner.js";

/**
 * The reauth banner across the two roles (issues 015 and 045). Reconnecting is an admin action,
 * but the outage is everyone's problem: a user still sees why the dashboard has stopped working,
 * and is told who can fix it instead of being handed a button that refuses them.
 */

const status = vi.fn<() => Promise<SetupStatus>>();
const authorize =
  vi.fn<(override?: { clientId: string; clientSecret: string }) => Promise<{ url: string }>>();

vi.mock("../api.js", () => ({
  api: {
    setup: {
      status: () => status(),
      connect: async () => ({}),
      authorize: (override?: { clientId: string; clientSecret: string }) => authorize(override),
    },
  },
}));

beforeEach(() => {
  status.mockReset();
  authorize.mockReset();
  authorize.mockResolvedValue({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc" });
  status.mockResolvedValue({
    configured: true,
    hasClientId: true,
    hasClientSecret: true,
    hasRefreshToken: true,
    activeFlow: "bundled",
    connectMode: "in-app",
    hasBundledClient: true,
    redirectUri: "http://127.0.0.1:8723/oauth/callback",
    liveEligibility: { mode: "unknown", reason: null, message: null, checkedAt: null },
  } as SetupStatus);
});
afterEach(cleanup);

function banner(canAdminister: boolean, onOpenSettings: () => void = () => {}) {
  return render(
    <ReauthBanner
      canAdminister={canAdminister}
      onReconnected={() => {}}
      onOpenSettings={onOpenSettings}
      flash={() => {}}
    />,
  );
}

it("offers an admin the reconnect", async () => {
  banner(true);
  expect(await screen.findByRole("button", { name: /reconnect/i })).toBeTruthy();
});

it("tells a user who can fix it, and offers no button that would refuse them", async () => {
  banner(false);
  expect(await screen.findByText(/an admin has to reconnect/i)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /reconnect/i })).toBeNull();
});

it("still says the connection is what broke", () => {
  banner(false);
  expect(screen.getByText(/youtube connection lost/i)).toBeTruthy();
});

// A headless host stores its own credentials, so the connection is editable — but not from here:
// replacing them means pasting a token into a form, which is Settings' job. The banner must route
// there rather than firing a consent flow this host cannot run.
it("routes to settings on a host with no browser to run consent in", async () => {
  status.mockResolvedValue({
    configured: true,
    hasClientId: true,
    hasClientSecret: true,
    hasRefreshToken: true,
    activeFlow: "override",
    connectMode: null,
    hasBundledClient: false,
    redirectUri: "http://127.0.0.1:8723/oauth/callback",
    liveEligibility: { mode: "unknown", reason: null, message: null, checkedAt: null },
  } as SetupStatus);
  const open = vi.fn();
  banner(true, open);
  const button = await screen.findByRole("button", { name: /reconnect in settings/i });
  fireEvent.click(button);
  expect(open).toHaveBeenCalled();
});


/**
 * On a hosted deployment the banner is the reconnect (issue 052, PRD-03 §4). There is no browser
 * for the server to drive, but there is one reading the banner — so Reconnect sends it to Google
 * rather than dead-ending in Settings at a form that asks for a token from a CLI script.
 */
it("reconnects a hosted deployment by sending the browser to Google", async () => {
  status.mockResolvedValue({
    configured: true,
    hasClientId: true,
    hasClientSecret: true,
    hasRefreshToken: true,
    activeFlow: "override",
    connectMode: "redirect",
    hasBundledClient: false,
    redirectUri: "https://live.example.org/api/setup/oauth/callback",
    liveEligibility: { mode: "unknown", reason: null, message: null, checkedAt: null },
  } as SetupStatus);
  const assign = vi.fn();
  const realLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign },
  });
  const open = vi.fn();
  try {
    banner(true, open);
    fireEvent.click(await screen.findByRole("button", { name: /^reconnect$/i }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth?state=abc",
    ));
    expect(open).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  }
});
