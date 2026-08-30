// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoginScreen } from "./LoginScreen.js";

const login = vi.fn<(name: string, password: string) => Promise<unknown>>();

vi.mock("../api.js", () => ({
  api: { auth: { login: (name: string, password: string) => login(name, password) } },
}));

beforeEach(() => {
  login.mockReset();
  login.mockResolvedValue({ account: { id: "a1", name: "operator", role: "admin" } });
});
afterEach(cleanup);

/** Fills the form and submits it, the way an operator signs in. */
function signIn(name = "operator", password = "a-long-enough-secret") {
  fireEvent.change(screen.getByLabelText(/username/i), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginScreen", () => {
  it("signs in and hands control back to the dashboard", async () => {
    const onSignedIn = vi.fn();
    render(<LoginScreen onSignedIn={onSignedIn} />);
    signIn();
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(login).toHaveBeenCalledWith("operator", "a-long-enough-secret");
  });

  it("shows the server's refusal and clears the password so it can be retyped", async () => {
    login.mockRejectedValue(new Error("Incorrect username or password."));
    render(<LoginScreen onSignedIn={vi.fn()} />);
    signIn();
    expect((await screen.findByRole("alert")).textContent).toMatch(/incorrect username or password/i);
    expect((screen.getByLabelText(/password/i) as HTMLInputElement).value).toBe("");
    // The username survives — only the secret is worth retyping.
    expect((screen.getByLabelText(/username/i) as HTMLInputElement).value).toBe("operator");
  });

  it("stays on the screen after a refusal instead of letting anyone through", async () => {
    const onSignedIn = vi.fn();
    login.mockRejectedValue(new Error("Incorrect username or password."));
    render(<LoginScreen onSignedIn={onSignedIn} />);
    signIn();
    await screen.findByRole("alert");
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("surfaces a rate-limit refusal as the server words it", async () => {
    login.mockRejectedValue(new Error("Too many sign-in attempts. Try again in 15 minute(s)."));
    render(<LoginScreen onSignedIn={vi.fn()} />);
    signIn();
    expect((await screen.findByRole("alert")).textContent).toMatch(/too many sign-in attempts/i);
  });

  it("cannot be submitted empty", () => {
    render(<LoginScreen onSignedIn={vi.fn()} />);
    const button = () => screen.getByRole("button", { name: /sign in/i }) as HTMLButtonElement;
    expect(button().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "operator" } });
    // A username alone is not a sign-in attempt.
    expect(button().disabled).toBe(true);
  });

  it("trims a username typed with a stray space", async () => {
    render(<LoginScreen onSignedIn={vi.fn()} />);
    signIn("  operator  ");
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith("operator", "a-long-enough-secret"),
    );
  });

  it("locks the form while the attempt is in flight", async () => {
    let release: () => void = () => {};
    login.mockReturnValue(new Promise((r) => (release = () => r(undefined))));
    render(<LoginScreen onSignedIn={vi.fn()} />);
    signIn();
    await waitFor(() =>
      expect((screen.getByLabelText(/username/i) as HTMLInputElement).disabled).toBe(true),
    );
    expect((screen.getByRole("button", { name: /signing in/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    release();
  });
});
