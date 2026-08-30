// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SessionInfo } from "../api.js";
import { SessionNotice } from "./SessionNotice.js";

const reauth = vi.fn<() => Promise<unknown>>();

vi.mock("../api.js", () => ({ api: { auth: { reauth: () => reauth() } } }));

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 0, 1);

const info = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  authRequired: true,
  authenticated: true,
  account: { id: "a1", name: "operator", role: "admin" },
  expiringSoon: true,
  absoluteExpiresAt: new Date(now + 3 * DAY).toISOString(),
  ...over,
});

beforeEach(() => {
  reauth.mockReset();
  reauth.mockResolvedValue({ ok: true });
  vi.setSystemTime(now);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SessionNotice", () => {
  it("warns how long a session near its cap has left", () => {
    render(<SessionNotice info={info()} onRenewed={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toMatch(/expires in 3 days/i);
  });

  it("renews without asking for the password again", async () => {
    const onRenewed = vi.fn();
    render(<SessionNotice info={info()} onRenewed={onRenewed} />);
    fireEvent.click(screen.getByRole("button", { name: /stay signed in/i }));
    await waitFor(() => expect(onRenewed).toHaveBeenCalled());
    expect(reauth).toHaveBeenCalled();
  });

  it("renders nothing while the session is healthy", () => {
    const { container } = render(
      <SessionNotice info={info({ expiringSoon: false })} onRenewed={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("keeps the notice up if renewal fails, so the warning is not lost", async () => {
    reauth.mockRejectedValue(new Error("Sign in to continue."));
    render(<SessionNotice info={info()} onRenewed={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /stay signed in/i }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/sign in to continue/i),
    );
  });
});
