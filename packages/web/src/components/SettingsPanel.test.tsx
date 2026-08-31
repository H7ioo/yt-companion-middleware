// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Person, SetupStatus } from "@app/shared";
import { SettingsPanel } from "./SettingsPanel.js";

/**
 * What the settings panel offers each role (issue 045). The connection card changes the channel
 * this whole deployment points at, so it belongs to an admin — and a user is shown the state of
 * the connection rather than a row of buttons that answer 403.
 */

const status = vi.fn<() => Promise<SetupStatus>>();
const listPeople = vi.fn<() => Promise<{ accounts: Person[] }>>();
const setRole = vi.fn<(id: string, role: Person["role"]) => Promise<{ account: Person }>>();

vi.mock("../api.js", () => ({
  api: {
    setup: { status: () => status() },
    people: { list: () => listPeople(), setRole: (id: string, role: Person["role"]) => setRole(id, role) },
  },
}));

const person = (over: Partial<Person> = {}): Person => ({
  id: "a1",
  name: "operator",
  role: "admin",
  createdAt: "2026-08-01T00:00:00.000Z",
  seeded: true,
  ...over,
});

const setupStatus = (over: Partial<SetupStatus> = {}): SetupStatus =>
  ({
    configured: true,
    hasClientId: true,
    hasClientSecret: true,
    hasRefreshToken: true,
    activeFlow: "bundled",
    canConnect: true,
    hasBundledClient: true,
    redirectUri: "http://127.0.0.1:8723/oauth/callback",
    ...over,
  }) as SetupStatus;

function panel(canAdminister: boolean) {
  return render(
    <SettingsPanel
      settings={{ defaultCategory: null, defaultStreamBoundId: null }}
      categories={[]}
      streams={[]}
      canAdminister={canAdminister}
      onSaveSettings={() => {}}
      flash={() => {}}
      onClose={() => {}}
    />,
  );
}

beforeEach(() => {
  status.mockReset();
  listPeople.mockReset();
  setRole.mockReset();
  status.mockResolvedValue(setupStatus());
  listPeople.mockResolvedValue({ accounts: [] });
});
afterEach(cleanup);

describe("the connection card", () => {
  it("gives an admin the connection controls", async () => {
    panel(true);
    expect(await screen.findByRole("button", { name: /reconnect/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeTruthy();
  });

  it("shows a user the connection without offering to change it", async () => {
    panel(false);
    expect(await screen.findByText(/only an admin can change/i)).toBeTruthy();
    expect(screen.getByText(/connected/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /reconnect/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
    expect(screen.queryByText(/use my own google client/i)).toBeNull();
  });

  it("leaves the app defaults to both roles — they shape the show, not the channel", async () => {
    panel(false);
    await waitFor(() => expect(screen.getByLabelText(/default category/i)).toBeTruthy());
    expect(screen.getByLabelText(/default stream binding/i)).toBeTruthy();
  });
});

describe("the people section", () => {
  const twoPeople = () => ({
    accounts: [person(), person({ id: "a2", name: "camera", role: "user", seeded: false })],
  });

  it("stays out of sight on a deployment with no accounts", async () => {
    // The desktop and LAN installs: one operator, no roles, nothing to manage.
    panel(true);
    await waitFor(() => expect(listPeople).toHaveBeenCalled());
    expect(screen.queryByText(/^People$/)).toBeNull();
  });

  it("lists who is here, and what each of them is", async () => {
    listPeople.mockResolvedValue(twoPeople());
    panel(true);
    expect(await screen.findByText("camera")).toBeTruthy();
    expect(screen.getByLabelText(/role for operator/i)).toHaveProperty("value", "admin");
    expect(screen.getByLabelText(/role for camera/i)).toHaveProperty("value", "user");
  });

  it("promotes someone when their role is changed", async () => {
    listPeople.mockResolvedValue(twoPeople());
    setRole.mockResolvedValue({ account: person({ id: "a2", name: "camera", role: "admin", seeded: false }) });
    panel(true);
    fireEvent.change(await screen.findByLabelText(/role for camera/i), { target: { value: "admin" } });
    await waitFor(() => expect(setRole).toHaveBeenCalledWith("a2", "admin"));
  });

  it("puts the refusal back on the screen when the last admin cannot be demoted", async () => {
    listPeople.mockResolvedValue({ accounts: [person()] });
    setRole.mockRejectedValue(new Error("operator is the last admin. Make someone else an admin first."));
    const flashed: string[] = [];
    render(
      <SettingsPanel
        settings={{ defaultCategory: null, defaultStreamBoundId: null }}
        categories={[]}
        streams={[]}
        canAdminister
        onSaveSettings={() => {}}
        flash={(message) => flashed.push(message)}
        onClose={() => {}}
      />,
    );
    fireEvent.change(await screen.findByLabelText(/role for operator/i), { target: { value: "user" } });
    await waitFor(() => expect(flashed[0]).toMatch(/last admin/i));
    // The select goes back to what the server still says it is, rather than lying about the change.
    expect(screen.getByLabelText(/role for operator/i)).toHaveProperty("value", "admin");
  });

  it("is not offered to a user at all", async () => {
    listPeople.mockResolvedValue(twoPeople());
    panel(false);
    await waitFor(() => expect(screen.getByText(/only an admin can change/i)).toBeTruthy());
    expect(listPeople).not.toHaveBeenCalled();
    expect(screen.queryByText("camera")).toBeNull();
  });
});
