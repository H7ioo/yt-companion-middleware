// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DeviceSession, InviteSummary, Person, SetupStatus } from "@app/shared";
import { SettingsPanel } from "./SettingsPanel.js";

/**
 * What the settings panel offers each role (issue 045). The connection card changes the channel
 * this whole deployment points at, so it belongs to an admin — and a user is shown the state of
 * the connection rather than a row of buttons that answer 403.
 */

const status = vi.fn<() => Promise<SetupStatus>>();
const listPeople = vi.fn<() => Promise<{ accounts: Person[] }>>();
const setRole = vi.fn<(id: string, role: Person["role"]) => Promise<{ account: Person }>>();
const listInvites = vi.fn<() => Promise<{ invites: InviteSummary[] }>>();
const createInvite =
  vi.fn<(role: Person["role"]) => Promise<{ token: string; path: string; invite: InviteSummary }>>();
const cancelInvite = vi.fn<(id: string) => Promise<{ ok: boolean }>>();
const removePerson = vi.fn<(id: string) => Promise<{ account: Person }>>();
const listSessions = vi.fn<(id: string) => Promise<{ sessions: DeviceSession[] }>>();
const revokeSession = vi.fn<(id: string, sessionId: string) => Promise<{ ok: boolean }>>();

vi.mock("../api.js", () => ({
  api: {
    setup: { status: () => status() },
    people: {
      list: () => listPeople(),
      setRole: (id: string, role: Person["role"]) => setRole(id, role),
      invites: () => listInvites(),
      invite: (role: Person["role"]) => createInvite(role),
      cancelInvite: (id: string) => cancelInvite(id),
      remove: (id: string) => removePerson(id),
      sessions: (id: string) => listSessions(id),
      revokeSession: (id: string, sessionId: string) => revokeSession(id, sessionId),
    },
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

function panel(canAdminister: boolean, flash: (m: string, k?: string) => void = () => {}) {
  return render(
    <SettingsPanel
      settings={{ defaultCategory: null, defaultStreamBoundId: null }}
      categories={[]}
      streams={[]}
      canAdminister={canAdminister}
      onSaveSettings={() => {}}
      flash={flash}
      onClose={() => {}}
    />,
  );
}

beforeEach(() => {
  status.mockReset();
  listPeople.mockReset();
  setRole.mockReset();
  listInvites.mockReset();
  createInvite.mockReset();
  cancelInvite.mockReset();
  removePerson.mockReset();
  listSessions.mockReset();
  revokeSession.mockReset();
  status.mockResolvedValue(setupStatus());
  listPeople.mockResolvedValue({ accounts: [] });
  listInvites.mockResolvedValue({ invites: [] });
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

/**
 * Invites and devices (issue 046). The panel is where an admin does the two things the issue is
 * really about — hand someone a way in, and take it away again — and both have a failure mode the
 * server cannot protect against: a link that is never copied, and a Remove clicked by accident.
 */
describe("invites", () => {
  const twoPeople = () => ({
    accounts: [person(), person({ id: "a2", name: "camera", role: "user" as const, seeded: false })],
  });
  const invite = (over: Partial<InviteSummary> = {}): InviteSummary => ({
    id: "i1",
    role: "user",
    createdAt: "2026-08-30T00:00:00.000Z",
    expiresAt: "2026-08-31T00:00:00.000Z",
    invitedBy: "operator",
    state: "open",
    redeemedBy: null,
    ...over,
  });

  it("shows the link once, and says it will not be shown again", async () => {
    listPeople.mockResolvedValue(twoPeople());
    createInvite.mockResolvedValue({ token: "tok", path: "/invite?token=tok", invite: invite() });
    panel(true);
    fireEvent.click(await screen.findByRole("button", { name: /create invite link/i }));

    // The whole URL, not just the path: it is going into a chat message, not an address bar.
    expect(await screen.findByText(`${window.location.origin}/invite?token=tok`)).toBeTruthy();
    expect(screen.getByText(/not shown again/i)).toBeTruthy();
  });

  it("creates the role the admin picked, not the default", async () => {
    listPeople.mockResolvedValue(twoPeople());
    createInvite.mockResolvedValue({
      token: "tok",
      path: "/invite?token=tok",
      invite: invite({ role: "admin" }),
    });
    panel(true);
    fireEvent.change(await screen.findByLabelText(/^role$/i), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: /create invite link/i }));
    await waitFor(() => expect(createInvite).toHaveBeenCalledWith("admin"));
  });

  it("offers Withdraw only on a link that still works", async () => {
    listPeople.mockResolvedValue(twoPeople());
    listInvites.mockResolvedValue({
      invites: [
        invite({ id: "i1", state: "open" }),
        invite({ id: "i2", state: "redeemed", redeemedBy: "camera" }),
        invite({ id: "i3", state: "expired" }),
      ],
    });
    panel(true);
    expect(await screen.findByText(/used by camera/i)).toBeTruthy();
    expect(screen.getByText(/expired/i)).toBeTruthy();
    // One open invite, so exactly one way to withdraw.
    expect(screen.getAllByRole("button", { name: /withdraw/i })).toHaveLength(1);
  });
});

describe("cutting someone off", () => {
  const twoPeople = () => ({
    accounts: [person(), person({ id: "a2", name: "camera", role: "user" as const, seeded: false })],
  });

  it("never offers to remove the account set up at install", async () => {
    listPeople.mockResolvedValue(twoPeople());
    panel(true);
    await screen.findByText("camera");
    // One Remove button, and it belongs to camera — the seeded operator has none, because the
    // server refuses and a button that always fails is worse than no button.
    expect(screen.getAllByRole("button", { name: /^remove$/i })).toHaveLength(1);
  });

  it("asks before removing, and does nothing if the answer is no", async () => {
    listPeople.mockResolvedValue(twoPeople());
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    panel(true);
    await screen.findByText("camera");
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(confirm).toHaveBeenCalled();
    expect(removePerson).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("removes once confirmed", async () => {
    listPeople.mockResolvedValue(twoPeople());
    removePerson.mockResolvedValue({ account: person({ id: "a2", name: "camera", seeded: false }) });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    panel(true);
    await screen.findByText("camera");
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    await waitFor(() => expect(removePerson).toHaveBeenCalledWith("a2"));
    confirm.mockRestore();
  });

  it("lists one person's devices and signs a single one out", async () => {
    listPeople.mockResolvedValue(twoPeople());
    listSessions.mockResolvedValue({
      sessions: [
        { id: "s1", createdAt: "2026-08-01T00:00:00.000Z", lastSeenAt: "2026-08-30T00:00:00.000Z", absoluteExpiresAt: "2026-10-30T00:00:00.000Z" },
        { id: "s2", createdAt: "2026-08-20T00:00:00.000Z", lastSeenAt: "2026-08-31T00:00:00.000Z", absoluteExpiresAt: "2026-11-18T00:00:00.000Z" },
      ],
    });
    revokeSession.mockResolvedValue({ ok: true });
    panel(true);
    await screen.findByText("camera");
    // Two people, so two Devices buttons — camera's is the second.
    fireEvent.click(screen.getAllByRole("button", { name: /devices/i })[1]);

    await waitFor(() => expect(listSessions).toHaveBeenCalledWith("a2"));
    const signOut = await screen.findAllByRole("button", { name: /sign out/i });
    expect(signOut).toHaveLength(2);

    fireEvent.click(signOut[0]);
    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith("a2", "s1"));
  });

  it("says so plainly when a person is not signed in anywhere", async () => {
    listPeople.mockResolvedValue(twoPeople());
    listSessions.mockResolvedValue({ sessions: [] });
    panel(true);
    await screen.findByText("camera");
    fireEvent.click(screen.getAllByRole("button", { name: /devices/i })[1]);
    expect(await screen.findByText(/not signed in on any device/i)).toBeTruthy();
  });
});
