// @vitest-environment jsdom
// Only the web components render React into a DOM; the rest of the repo stays on plain `node`,
// so the environment is declared per-file rather than globally.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SetupStatus } from "../api.js";
import { SetupScreen } from "./SetupScreen.js";

const status = vi.fn<() => Promise<SetupStatus>>();
const connect = vi.fn<(override?: { clientId: string; clientSecret: string }) => Promise<unknown>>();
const save = vi.fn<(creds: unknown) => Promise<unknown>>();
const authorize = vi.fn<(override?: { clientId: string; clientSecret: string }) => Promise<{ url: string }>>();

vi.mock("../api.js", () => ({
  api: {
    setup: {
      status: () => status(),
      connect: (override?: { clientId: string; clientSecret: string }) => connect(override),
      save: (creds: unknown) => save(creds),
      authorize: (override?: { clientId: string; clientSecret: string }) => authorize(override),
    },
  },
}));

const setupStatus = (over: Partial<SetupStatus> = {}): SetupStatus =>
  ({
    configured: false,
    hasClientId: false,
    hasClientSecret: false,
    hasRefreshToken: false,
    activeFlow: null,
    connectMode: "in-app",
    hasBundledClient: true,
    redirectUri: "http://127.0.0.1:8723/oauth/callback",
    ...over,
  }) as SetupStatus;

beforeEach(() => {
  status.mockReset();
  connect.mockReset();
  save.mockReset();
  authorize.mockReset();
  authorize.mockResolvedValue({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc" });
  status.mockResolvedValue(setupStatus());
  connect.mockResolvedValue({ ok: true });
  save.mockResolvedValue({ ok: true, restarting: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

/** Runs out the restart poll in `waitForReady` without waiting on real wall-clock time. */
async function settleRestart() {
  await vi.advanceTimersByTimeAsync(2000);
}

describe("SetupScreen", () => {
  describe("the desktop build, with a bundled client", () => {
    it("leads with one click and keeps the credential fields folded away", async () => {
      render(<SetupScreen onReady={() => {}} />);

      expect(await screen.findByRole("button", { name: "Connect YouTube" })).toBeDefined();
      expect(screen.queryByLabelText("Client ID")).toBeNull();
      expect(screen.getByRole("button", { name: "Use my own credentials instead" })).toBeDefined();
    });

    it("reveals the operator's own client behind the disclosure", async () => {
      render(<SetupScreen onReady={() => {}} />);

      fireEvent.click(await screen.findByRole("button", { name: "Use my own credentials instead" }));

      expect(field("Client ID")).toBeDefined();
      expect(field("Client secret")).toBeDefined();
      // The in-app flow fetches the token; nothing is ever pasted on a host that can browse.
      expect(screen.queryByLabelText("Refresh token")).toBeNull();
    });

    it("warns that Google's unverified-app screen is expected, not a failure", async () => {
      render(<SetupScreen onReady={() => {}} />);

      expect(await screen.findByText(/Google hasn’t verified this app/)).toBeDefined();
    });

    it("runs the bundled flow and reports ready once the server comes back", async () => {
      vi.useFakeTimers();
      const onReady = vi.fn();
      status
        .mockResolvedValueOnce(setupStatus())
        .mockResolvedValue(setupStatus({ configured: true }));
      render(<SetupScreen onReady={onReady} />);

      await vi.waitFor(() => screen.getByRole("button", { name: "Connect YouTube" }));
      fireEvent.click(screen.getByRole("button", { name: "Connect YouTube" }));

      await vi.waitFor(() => expect(connect).toHaveBeenCalledWith(undefined));
      await settleRestart();
      expect(onReady).toHaveBeenCalledTimes(1);
    });

    it("shows the flow's error and unlocks the button so it can be retried", async () => {
      connect.mockRejectedValue(new Error("Consent window closed"));
      const onReady = vi.fn();
      render(<SetupScreen onReady={onReady} />);

      fireEvent.click(await screen.findByRole("button", { name: "Connect YouTube" }));

      expect(await screen.findByText("Consent window closed")).toBeDefined();
      expect(onReady).not.toHaveBeenCalled();
      const button = screen.getByRole("button", { name: "Connect YouTube" }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });
  });

  describe("an override build — a host that can browse but ships no client", () => {
    beforeEach(() => status.mockResolvedValue(setupStatus({ hasBundledClient: false })));

    it("goes straight to the credential form with no one-click button", async () => {
      render(<SetupScreen onReady={() => {}} />);

      expect(await screen.findByLabelText("Client ID")).toBeDefined();
      expect(screen.queryByRole("button", { name: "Connect YouTube" })).toBeNull();
      expect(screen.queryByLabelText("Refresh token")).toBeNull();
    });

    it("shows the redirect URI the operator must register on their own client", async () => {
      render(<SetupScreen onReady={() => {}} />);

      expect(await screen.findByText("http://127.0.0.1:8723/oauth/callback")).toBeDefined();
    });

    it("will not submit until both halves of the client are present", async () => {
      render(<SetupScreen onReady={() => {}} />);
      const submit = () =>
        screen.getByRole("button", { name: "Connect with my client" }) as HTMLButtonElement;

      await screen.findByLabelText("Client ID");
      expect(submit().disabled).toBe(true);

      fireEvent.change(field("Client ID"), { target: { value: "abc.apps.googleusercontent.com" } });
      expect(submit().disabled).toBe(true);

      fireEvent.change(field("Client secret"), { target: { value: "GOCSPX-x" } });
      expect(submit().disabled).toBe(false);
    });

    it("runs the in-app flow against the entered client, trimmed", async () => {
      // Fake timers so `waitForReady`'s poll is run out here rather than left ticking on the
      // shared `status` mock for whichever test comes next.
      vi.useFakeTimers();
      status
        .mockResolvedValueOnce(setupStatus({ hasBundledClient: false }))
        .mockResolvedValue(setupStatus({ hasBundledClient: false, configured: true }));
      const onReady = vi.fn();
      render(<SetupScreen onReady={onReady} />);

      await vi.waitFor(() => screen.getByLabelText("Client ID"));
      fireEvent.change(field("Client ID"), { target: { value: "  abc.apps.googleusercontent.com  " } });
      fireEvent.change(field("Client secret"), { target: { value: " GOCSPX-x " } });
      fireEvent.click(screen.getByRole("button", { name: "Connect with my client" }));

      await vi.waitFor(() =>
        expect(connect).toHaveBeenCalledWith({
          clientId: "abc.apps.googleusercontent.com",
          clientSecret: "GOCSPX-x",
        }),
      );
      await settleRestart();
      expect(onReady).toHaveBeenCalledTimes(1);
      // Only the client is entered — the flow fetches the token itself.
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe("a headless host — Docker, no browser to drive", () => {
    beforeEach(() =>
      status.mockResolvedValue(setupStatus({ connectMode: null, hasBundledClient: false })),
    );

    it("asks for the refresh token, because there is no consent screen to open", async () => {
      render(<SetupScreen onReady={() => {}} />);

      expect(await screen.findByLabelText("Refresh token")).toBeDefined();
      expect(screen.queryByRole("button", { name: "Connect YouTube" })).toBeNull();
    });

    it("will not submit until all three credentials are present", async () => {
      render(<SetupScreen onReady={() => {}} />);
      const submit = () =>
        screen.getByRole("button", { name: "Connect channel" }) as HTMLButtonElement;

      await screen.findByLabelText("Refresh token");
      fireEvent.change(field("Client ID"), { target: { value: "abc" } });
      fireEvent.change(field("Client secret"), { target: { value: "GOCSPX-x" } });
      expect(submit().disabled).toBe(true);

      fireEvent.change(field("Refresh token"), { target: { value: "1//token" } });
      expect(submit().disabled).toBe(false);
    });

    it("saves the trimmed credentials and reports ready once the server restarts", async () => {
      vi.useFakeTimers();
      const onReady = vi.fn();
      status
        .mockResolvedValueOnce(setupStatus({ connectMode: null, hasBundledClient: false }))
        .mockResolvedValue(setupStatus({ connectMode: null, hasBundledClient: false, configured: true }));
      render(<SetupScreen onReady={onReady} />);

      await vi.waitFor(() => screen.getByLabelText("Refresh token"));
      fireEvent.change(field("Client ID"), { target: { value: " abc " } });
      fireEvent.change(field("Client secret"), { target: { value: " GOCSPX-x " } });
      fireEvent.change(field("Refresh token"), { target: { value: " 1//token " } });
      fireEvent.click(screen.getByRole("button", { name: "Connect channel" }));

      await vi.waitFor(() =>
        expect(save).toHaveBeenCalledWith({
          clientId: "abc",
          clientSecret: "GOCSPX-x",
          refreshToken: "1//token",
        }),
      );
      await settleRestart();
      expect(onReady).toHaveBeenCalledTimes(1);
    });

    it("hides the secrets from over the operator's shoulder", async () => {
      render(<SetupScreen onReady={() => {}} />);

      await screen.findByLabelText("Refresh token");
      expect(field("Client secret").type).toBe("password");
      expect(field("Refresh token").type).toBe("password");
      expect(field("Client ID").type).toBe("text");
    });

    it("says so, rather than hanging, when the restarted server never comes back", async () => {
      vi.useFakeTimers();
      const onReady = vi.fn();
      render(<SetupScreen onReady={onReady} />);

      await vi.waitFor(() => screen.getByLabelText("Refresh token"));
      fireEvent.change(field("Client ID"), { target: { value: "abc" } });
      fireEvent.change(field("Client secret"), { target: { value: "s" } });
      fireEvent.change(field("Refresh token"), { target: { value: "t" } });
      fireEvent.click(screen.getByRole("button", { name: "Connect channel" }));

      await vi.advanceTimersByTimeAsync(20000);
      await vi.waitFor(() => screen.getByText(/the server did not come back/));
      expect(onReady).not.toHaveBeenCalled();
    });
  });

  it("falls back to the manual form when the status probe itself fails", async () => {
    status.mockRejectedValue(new Error("no server"));
    render(<SetupScreen onReady={() => {}} />);

    // canConnect stays false, so this is the paste-the-token form — the safe assumption when
    // the host's capabilities are unknown.
    expect(await screen.findByLabelText("Refresh token")).toBeDefined();
  });
});

/**
 * The hosted deployment (issue 052). It is headless — nothing here can open a browser — but it is
 * not the paste-a-refresh-token case: the admin's own browser does the consent and returns through
 * the public callback, so what the screen must do is send them there, not send them to a CLI.
 */
describe("SetupScreen on a hosted deployment", () => {
  const HOSTED = {
    connectMode: "redirect" as const,
    hasBundledClient: false,
    redirectUri: "https://live.example.org/api/setup/oauth/callback",
  };
  let assign: ReturnType<typeof vi.fn>;
  let realLocation: Location;

  beforeEach(() => {
    status.mockResolvedValue(setupStatus(HOSTED));
    assign = vi.fn();
    realLocation = window.location;
    // jsdom refuses a real navigation, and a real one would end the test anyway.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  });

  it("never asks for a refresh token", async () => {
    render(<SetupScreen onReady={() => {}} />);

    await screen.findByLabelText("Client ID");
    expect(screen.queryByLabelText("Refresh token")).toBeNull();
  });

  it("shows the public callback as the URI to register, not the loopback one", async () => {
    render(<SetupScreen onReady={() => {}} />);

    // Registered by hand in the Google console; a wrong one fails at consent, not at boot.
    expect(await screen.findByText(HOSTED.redirectUri)).toBeDefined();
  });

  it("sends the browser to Google's consent screen with the entered client", async () => {
    render(<SetupScreen onReady={() => {}} />);

    await screen.findByLabelText("Client ID");
    fireEvent.change(field("Client ID"), { target: { value: " mine.apps " } });
    fireEvent.change(field("Client secret"), { target: { value: " GOCSPX-x " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to Google" }));

    await vi.waitFor(() =>
      expect(authorize).toHaveBeenCalledWith({ clientId: "mine.apps", clientSecret: "GOCSPX-x" }),
    );
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=abc"),
    );
    // The in-app flow is the wrong one here and would hang: nothing on this host can open a
    // browser, so the request would sit open until it timed out.
    expect(connect).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("uses the bundled client in one click when the build ships one", async () => {
    status.mockResolvedValue(setupStatus({ ...HOSTED, hasBundledClient: true }));
    render(<SetupScreen onReady={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Connect YouTube" }));

    await vi.waitFor(() => expect(authorize).toHaveBeenCalledWith(undefined));
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());
  });

  it("stays put and explains itself when the flow cannot be started", async () => {
    authorize.mockRejectedValue(new Error("No OAuth client available"));
    render(<SetupScreen onReady={() => {}} />);

    await screen.findByLabelText("Client ID");
    fireEvent.change(field("Client ID"), { target: { value: "mine.apps" } });
    fireEvent.change(field("Client secret"), { target: { value: "GOCSPX-x" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to Google" }));

    expect(await screen.findByText("No OAuth client available")).toBeDefined();
    expect(assign).not.toHaveBeenCalled();
  });

});

/**
 * The other half of the round trip: consent failed, Google sent the browser back through the
 * callback, and the server put its explanation in the query string. The screen has to surface it —
 * the admin left this page and came back to a fresh mount that remembers nothing.
 */
describe("SetupScreen after a failed hosted consent", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("shows what the server said, then clears it from the address bar", async () => {
    status.mockResolvedValue(
      setupStatus({ connectMode: "redirect", hasBundledClient: false }),
    );
    window.history.replaceState(null, "", "/?connect_error=Google%20refused%20the%20sign-in");

    render(<SetupScreen onReady={() => {}} />);

    expect(await screen.findByText("Google refused the sign-in")).toBeDefined();
    // Cleared, so a reload does not replay an error already dealt with.
    expect(window.location.search).not.toContain("connect_error");
  });
});
