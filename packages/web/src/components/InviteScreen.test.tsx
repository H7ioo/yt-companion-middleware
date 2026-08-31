// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InviteScreen } from "./InviteScreen.js";

/**
 * Redeeming an invite (issue 046). The two things this screen must get right are the two ways a
 * person is left stuck: a dead link that only says so after a password has been chosen, and a
 * link whose role is a surprise once they are already in.
 */

const inspect = vi.fn<(token: string) => Promise<{ ok: boolean; role: "admin" | "user"; expiresAt: string }>>();
const redeem = vi.fn<(token: string, name: string, password: string) => Promise<unknown>>();

vi.mock("../api.js", () => ({
  api: { invite: { inspect: (t: string) => inspect(t), redeem: (t: string, n: string, p: string) => redeem(t, n, p) } },
}));

const onRedeemed = vi.fn();

beforeEach(() => {
  inspect.mockReset();
  redeem.mockReset();
  onRedeemed.mockReset();
  inspect.mockResolvedValue({ ok: true, role: "user", expiresAt: "2026-09-01T00:00:00.000Z" });
  redeem.mockResolvedValue({ account: { id: "a2", name: "sound", role: "user" } });
});
afterEach(cleanup);

const show = () => render(<InviteScreen token="tok" onRedeemed={onRedeemed} />);

describe("arriving on an invite link", () => {
  it("says what the invite grants before anything is typed", async () => {
    show();
    expect(await screen.findByText("User")).toBeTruthy();
    expect(screen.getByText(/run the show/i)).toBeTruthy();
  });

  it("names admin access as admin, so it is not a surprise later", async () => {
    inspect.mockResolvedValue({ ok: true, role: "admin", expiresAt: "2026-09-01T00:00:00.000Z" });
    show();
    expect(await screen.findByText("Admin")).toBeTruthy();
    expect(screen.getByText(/manages? people and the youtube connection/i)).toBeTruthy();
  });

  it("shows a dead link as a dead end, with no password box to fill in", async () => {
    inspect.mockRejectedValue(new Error("This invite has already been used. Ask an admin for a new link."));
    show();
    expect(await screen.findByText(/already been used/i)).toBeTruthy();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /create account/i })).toBeNull();
  });
});

describe("setting up the account", () => {
  it("will not submit a password the server is going to refuse", async () => {
    show();
    await screen.findByText("User");
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "sound" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "short" } });
    expect((screen.getByRole("button", { name: /create account/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "a-long-enough-secret" } });
    expect((screen.getByRole("button", { name: /create account/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("redeems and hands back to the dashboard", async () => {
    show();
    await screen.findByText("User");
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "sound" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "a-long-enough-secret" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(onRedeemed).toHaveBeenCalled());
    expect(redeem).toHaveBeenCalledWith("tok", "sound", "a-long-enough-secret");
  });

  it("puts the server's refusal on screen and clears the password to retype", async () => {
    redeem.mockRejectedValue(new Error('Someone here is already called "sound".'));
    show();
    await screen.findByText("User");
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "sound" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "a-long-enough-secret" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/already called/i);
    expect(onRedeemed).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/password/i) as HTMLInputElement).value).toBe("");
  });
});
