// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  AuditEntry,
  DeviceSession,
  DeviceTokenSummary,
  GraceReadout,
  InviteSummary,
  Person,
  SetupStatus,
} from "@app/shared";
import { LIVE_ELIGIBILITY_GLOSSARY } from "@app/shared";
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
const listMachines = vi.fn<() => Promise<{ tokens: DeviceTokenSummary[] }>>();
const createMachine =
  vi.fn<(name: string) => Promise<{ token: string; device: DeviceTokenSummary }>>();
const revokeMachine = vi.fn<(id: string) => Promise<{ device: DeviceTokenSummary }>>();
const graceOf = vi.fn<() => Promise<GraceReadout>>();
const listAudit =
  vi.fn<(opts?: { limit?: number; notable?: boolean }) => Promise<{ entries: AuditEntry[] }>>();
const saveCreds =
  vi.fn<
    (c: { clientId: string; clientSecret: string; refreshToken: string }) => Promise<{
      ok: boolean;
      restarting: boolean;
    }>
  >();

const authorize =
  vi.fn<(override?: { clientId: string; clientSecret: string }) => Promise<{ url: string }>>();

vi.mock("../api.js", () => ({
  api: {
    setup: {
      status: () => status(),
      save: (c: { clientId: string; clientSecret: string; refreshToken: string }) => saveCreds(c),
      authorize: (override?: { clientId: string; clientSecret: string }) => authorize(override),
    },
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
    machines: {
      list: () => listMachines(),
      create: (name: string) => createMachine(name),
      revoke: (id: string) => revokeMachine(id),
      grace: () => graceOf(),
    },
    audit: { list: (opts?: { limit?: number; notable?: boolean }) => listAudit(opts) },
  },
}));

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: "e1",
  ts: "2026-08-30T19:04:00.000Z",
  actor: { kind: "person", id: "a1", name: "operator" },
  action: "changed a role",
  method: "PUT",
  path: "/api/dashboard/people/a2/role",
  target: "a2",
  outcome: "ok",
  status: 200,
  detail: { role: "admin" },
  notable: true,
  ...over,
});

const machine = (over: Partial<DeviceTokenSummary> = {}): DeviceTokenSummary => ({
  id: "m1",
  name: "companion machine",
  createdAt: "2026-08-01T00:00:00.000Z",
  createdBy: "operator",
  lastUsedAt: null,
  revokedAt: null,
  ...over,
});

const grace = (over: Partial<GraceReadout> = {}): GraceReadout => ({
  enforcing: false,
  daysSinceTokenless: 2,
  daysRequired: 14,
  goLivesSinceTokenless: 0,
  goLivesRequired: 1,
  met: false,
  lastTokenlessAt: "2026-08-29T10:00:00.000Z",
  lastTokenlessClient: "Companion/3.4.0",
  lastTokenlessFrom: "192.168.1.40",
  lastTokenlessRoute: "/api/action",
  tokenlessCount: 37,
  ...over,
});

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
    connectMode: "in-app",
    hasBundledClient: true,
    redirectUri: "http://127.0.0.1:8723/oauth/callback",
    liveEligibility: { mode: "unknown", reason: null, message: null, checkedAt: null },
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
  listMachines.mockReset();
  createMachine.mockReset();
  revokeMachine.mockReset();
  graceOf.mockReset();
  listAudit.mockReset();
  saveCreds.mockReset();
  saveCreds.mockResolvedValue({ ok: true, restarting: true });
  listMachines.mockResolvedValue({ tokens: [] });
  graceOf.mockResolvedValue(grace());
  listAudit.mockResolvedValue({ entries: [] });
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

  // A headless host cannot open a browser for Google's consent screen, but its credentials still
  // live in the app's store — env vars are ignored while they do. Before this, the card told the
  // operator to edit the environment, which the server does not read, and a stale refresh token
  // was unfixable from the UI.
  describe("on a headless host with stored credentials", () => {
    const headless = () =>
      status.mockResolvedValue(setupStatus({ connectMode: null, activeFlow: "override" }));

    it("offers the paste form instead of env guidance", async () => {
      headless();
      panel(true);
      expect(await screen.findByLabelText(/refresh token/i)).toBeTruthy();
      expect(screen.getByLabelText(/client id/i)).toBeTruthy();
      expect(screen.getByLabelText(/client secret/i)).toBeTruthy();
      expect(screen.queryByText(/managed outside the app/i)).toBeNull();
      expect(screen.getByRole("button", { name: /disconnect/i })).toBeTruthy();
    });

    it("says that a stored connection beats the environment", async () => {
      headless();
      panel(true);
      expect(await screen.findByText(/wins over/i)).toBeTruthy();
    });

    it("saves all three credentials, so a stale refresh token can be replaced", async () => {
      headless();
      const flash = vi.fn();
      panel(true, flash);
      fireEvent.change(await screen.findByLabelText(/client id/i), {
        target: { value: "406591.apps.googleusercontent.com" },
      });
      fireEvent.change(screen.getByLabelText(/client secret/i), {
        target: { value: "GOCSPX-secret" },
      });
      fireEvent.change(screen.getByLabelText(/refresh token/i), { target: { value: "1//new" } });
      fireEvent.click(screen.getByRole("button", { name: /replace credentials/i }));
      await waitFor(() =>
        expect(saveCreds).toHaveBeenCalledWith({
          clientId: "406591.apps.googleusercontent.com",
          clientSecret: "GOCSPX-secret",
          refreshToken: "1//new",
        }),
      );
    });

    it("will not submit a partly filled form", async () => {
      headless();
      panel(true);
      fireEvent.change(await screen.findByLabelText(/client id/i), { target: { value: "abc" } });
      expect(
        (screen.getByRole("button", { name: /replace credentials/i }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(saveCreds).not.toHaveBeenCalled();
    });

    it("still shows a user no way to change it", async () => {
      headless();
      panel(false);
      expect(await screen.findByText(/only an admin can change/i)).toBeTruthy();
      expect(screen.queryByLabelText(/refresh token/i)).toBeNull();
    });
  });

  it("keeps env/CLI credentials read-only — the store is not what backs them", async () => {
    status.mockResolvedValue(setupStatus({ connectMode: null, activeFlow: "env" }));
    panel(true);
    expect(await screen.findByText(/managed outside the app/i)).toBeTruthy();
    expect(screen.queryByLabelText(/refresh token/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
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

describe("the machines section", () => {
  beforeEach(() => {
    listPeople.mockResolvedValue({ accounts: [person(), person({ id: "a2", name: "camera", role: "user", seeded: false })] });
  });

  it("is not offered to a user — a key that runs the show is an admin's to hand out", async () => {
    panel(false);
    await waitFor(() => expect(screen.getByLabelText(/default category/i)).toBeTruthy());
    expect(screen.queryByRole("heading", { name: /machines/i })).toBeNull();
  });

  it("shows both halves of the evidence, never a single verdict", async () => {
    graceOf.mockResolvedValue(grace({ daysSinceTokenless: 14, goLivesSinceTokenless: 0 }));
    panel(true);

    // The off-season case: the clock is satisfied and the answer is still no. A panel that
    // showed only the days here would say "ready" and take the next show dark.
    // Both gauges, with their thresholds, and the verdict that reads them together.
    expect(await screen.findByText("Quiet days")).toBeTruthy();
    expect(screen.getByText("Go-lives since")).toBeTruthy();
    expect(screen.getByText("/ 14")).toBeTruthy();
    expect(screen.getByText("/ 1")).toBeTruthy();
    expect(screen.getByText(/quiet days alone are not evidence/i)).toBeTruthy();
  });

  it("names what is still connecting the old way", async () => {
    panel(true);
    expect(await screen.findByText(/still connecting without a key/i)).toBeTruthy();
    expect(screen.getByText(/Companion\/3\.4\.0/)).toBeTruthy();
    expect(screen.getByText(/192\.168\.1\.40/)).toBeTruthy();
  });

  it("calls it safe only when both halves hold", async () => {
    graceOf.mockResolvedValue(grace({ daysSinceTokenless: 21, goLivesSinceTokenless: 2, met: true }));
    panel(true);
    expect(await screen.findByText(/both halves hold/i)).toBeTruthy();
  });

  it("shows a minted key once, and says it will not come back", async () => {
    createMachine.mockResolvedValue({ token: "ytm_abc123", device: machine() });
    panel(true);

    const name = await screen.findByLabelText(/machine name/i);
    fireEvent.change(name, { target: { value: "booth laptop" } });
    fireEvent.click(screen.getByRole("button", { name: /create key/i }));

    expect(await screen.findByText("ytm_abc123")).toBeTruthy();
    expect(screen.getByText(/not shown again/i)).toBeTruthy();
    expect(createMachine).toHaveBeenCalledWith("booth laptop");
  });

  it("will not mint a nameless key, because a nameless key cannot be revoked with confidence", async () => {
    panel(true);
    const button = await screen.findByRole("button", { name: /create key/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists a revoked key as a record rather than dropping it", async () => {
    listMachines.mockResolvedValue({
      tokens: [machine({ revokedAt: "2026-08-30T00:00:00.000Z", lastUsedAt: "2026-08-29T00:00:00.000Z" })],
    });
    panel(true);
    expect(await screen.findByText(/revoked/i)).toBeTruthy();
    // No button on a key that is already dead: one that always fails is worse than none.
    expect(screen.queryByRole("button", { name: /^revoke$/i })).toBeNull();
  });

  it("confirms before cutting a machine off mid-show", async () => {
    listMachines.mockResolvedValue({ tokens: [machine()] });
    revokeMachine.mockResolvedValue({ device: machine({ revokedAt: "2026-08-31T00:00:00.000Z" }) });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    panel(true);

    fireEvent.click(await screen.findByRole("button", { name: /^revoke$/i }));
    expect(confirm).toHaveBeenCalled();
    expect(revokeMachine).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }));
    await waitFor(() => expect(revokeMachine).toHaveBeenCalledWith("m1"));
    confirm.mockRestore();
  });
});

/**
 * The audit log section (issue 050). An admin's answer to "who did that, and when" — so what is
 * under test is that it is *theirs alone*, that it asks for the entries that matter first, and
 * that an empty log says so rather than showing an empty box.
 */
describe("the audit log", () => {
  it("shows an admin who did what", async () => {
    listPeople.mockResolvedValue({ accounts: [person()] });
    listAudit.mockResolvedValue({
      entries: [entry(), entry({ id: "e2", action: "ran a preset", notable: false, actor: { kind: "machine", id: "m1", name: "companion machine" } })],
    });
    panel(true);

    expect(await screen.findByText("Audit log")).toBeTruthy();
    expect(await screen.findByText("changed a role")).toBeTruthy();
    // The machine is named by its key, not reported as an unknown caller.
    expect(await screen.findByText("companion machine")).toBeTruthy();
  });

  it("opens on the entries someone came looking for, and can widen to everything", async () => {
    listPeople.mockResolvedValue({ accounts: [person()] });
    listAudit.mockResolvedValue({ entries: [entry()] });
    panel(true);

    await waitFor(() => expect(listAudit).toHaveBeenCalled());
    expect(listAudit.mock.calls[0][0]).toMatchObject({ notable: true });

    fireEvent.click(await screen.findByRole("button", { name: "Everything" }));
    await waitFor(() =>
      expect(listAudit.mock.calls.some((c) => c[0]?.notable === false)).toBe(true),
    );
  });

  it("says the log is empty rather than showing an empty box", async () => {
    listPeople.mockResolvedValue({ accounts: [person()] });
    listAudit.mockResolvedValue({ entries: [] });
    panel(true);
    expect(await screen.findByText(/No account or role changes/i)).toBeTruthy();
  });

  it("is not offered to a user at all", async () => {
    listPeople.mockResolvedValue({ accounts: [person()] });
    listAudit.mockResolvedValue({ entries: [entry()] });
    panel(false);
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(screen.queryByText("Audit log")).toBeNull();
    // And it is never even asked for: a request that answers 403 is not a request to make.
    expect(listAudit).not.toHaveBeenCalled();
  });
});

/**
 * Riding mode belongs on the connection card, next to "which channel are we connected to"
 * (issue 061 / PRD-16 §6). A channel can be Connected and green while YouTube still refuses to
 * let it create anything, and that is the one place an operator looks to find out what they have.
 */
describe("SettingsPanel channel eligibility", () => {
  it("names the mode on the connection card", async () => {
    status.mockResolvedValue(
      setupStatus({
        liveEligibility: {
          mode: "riding",
          reason: "insufficientLivePermissions",
          message: "The user is not enabled for live streaming.",
          checkedAt: "2026-09-03T10:00:00.000Z",
        },
      }),
    );
    panel(true);
    expect(await screen.findByText(LIVE_ELIGIBILITY_GLOSSARY.riding.label)).toBeTruthy();
  });

  it("says the channel is creating broadcasts once one has been created", async () => {
    status.mockResolvedValue(
      setupStatus({
        liveEligibility: {
          mode: "driving",
          reason: null,
          message: null,
          checkedAt: "2026-09-03T10:00:00.000Z",
        },
      }),
    );
    panel(true);
    expect(await screen.findByText(LIVE_ELIGIBILITY_GLOSSARY.driving.label)).toBeTruthy();
  });
});

/**
 * Reconnecting on a hosted deployment (issue 052). The connection card is where a dead token gets
 * replaced, and until now a headless host had exactly one answer: run a CLI script and paste the
 * result. A deployment that knows its public origin has a better one — send the admin to Google.
 */
describe("the connection card on a hosted deployment", () => {
  let assign: ReturnType<typeof vi.fn>;
  let realLocation: Location;

  beforeEach(() => {
    status.mockResolvedValue(setupStatus({ connectMode: "redirect", activeFlow: "override" }));
    authorize.mockReset();
    authorize.mockResolvedValue({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc" });
    assign = vi.fn();
    realLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  });

  it("offers reconnect instead of the paste-a-token form", async () => {
    panel(true);
    expect(await screen.findByRole("button", { name: /reconnect/i })).toBeTruthy();
    // The whole point: nobody has to go and run get-refresh-token.mjs any more.
    expect(screen.queryByLabelText(/refresh token/i)).toBeNull();
    expect(screen.queryByText(/get-refresh-token/i)).toBeNull();
  });

  it("sends the browser to Google when reconnect is pressed", async () => {
    panel(true);
    fireEvent.click(await screen.findByRole("button", { name: /reconnect/i }));
    await waitFor(() => expect(authorize).toHaveBeenCalledWith(undefined));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=abc"),
    );
  });

  it("shows the public callback as the URI to register on an own client", async () => {
    status.mockResolvedValue(
      setupStatus({
        connectMode: "redirect",
        activeFlow: "override",
        redirectUri: "https://live.example.org/api/setup/oauth/callback",
      }),
    );
    panel(true);
    fireEvent.click(await screen.findByRole("button", { name: /use my own google client/i }));
    expect(
      await screen.findByText("https://live.example.org/api/setup/oauth/callback"),
    ).toBeTruthy();
  });

  it("keeps a way back in when the round trip cannot be made to work", async () => {
    // PUBLIC_ORIGIN moves a headless host from `manual` to `redirect`, which took the paste form
    // away everywhere. An unregistered redirect URI or a Workspace policy then left an admin with
    // a button that could not work and no in-app way to replace the credentials at all.
    panel(true);
    fireEvent.click(await screen.findByRole("button", { name: /Google won’t send me back here/ }));

    fireEvent.change(screen.getByLabelText(/client id/i), { target: { value: "mine.apps" } });
    fireEvent.change(screen.getByLabelText(/client secret/i), { target: { value: "GOCSPX-x" } });
    fireEvent.change(screen.getByLabelText(/refresh token/i), { target: { value: "1//new" } });
    fireEvent.click(screen.getByRole("button", { name: /replace credentials/i }));

    await waitFor(() =>
      expect(saveCreds).toHaveBeenCalledWith({
        clientId: "mine.apps",
        clientSecret: "GOCSPX-x",
        refreshToken: "1//new",
      }),
    );
    // The fallback is a fallback: it does not send anyone to Google on the way.
    expect(authorize).not.toHaveBeenCalled();
  });

  it("still shows a user no way to change it", async () => {
    panel(false);
    expect(await screen.findByText(/only an admin can change/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /reconnect/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /paste credentials instead/i })).toBeNull();
  });
});
