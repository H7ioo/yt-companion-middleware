import { useEffect, useRef, useState } from "react";
import {
  api,
  type AuditEntry,
  type Category,
  type DefaultSettings,
  type Person,
  type InviteSummary,
  type DeviceSession,
  type DeviceTokenSummary,
  type GraceReadout,
  type SetupStatus,
  type StreamInfo,
} from "../api.js";
import { describeConnection } from "../lib/connection.js";
import { CategorySelect } from "./CategorySelect.js";
import { StreamBindingField } from "./StreamBindingField.js";
import { useEscape } from "../lib/useEscape.js";

interface Props {
  settings: DefaultSettings;
  categories: Category[];
  streams: StreamInfo[];
  /** False for a signed-in user: the connection is theirs to read, not to change (issue 045). */
  canAdminister: boolean;
  onSaveSettings: (next: DefaultSettings) => void;
  flash: (message: string, kind?: "ok" | "err") => void;
  onClose: () => void;
}

type Busy = "idle" | "connecting" | "waiting" | "disconnecting";

/**
 * Settings page (issue 014 / PRD-03 §3): a Connection section (status, active flow,
 * Connect / Reconnect / Disconnect) alongside the app defaults, reachable any time — not just on
 * first run. Reads the connection state as booleans from `/api/setup/status`; secrets never arrive
 * here. On a headless/Docker host, or when credentials come from env/CLI, the connection is
 * read-only and shows guidance instead of buttons. A user — as opposed to an admin — reads the
 * same connection state and is offered none of the controls (issue 045): changing the channel is
 * how a deployment loses it, and a button that always answers 403 is worse than no button.
 */
export function SettingsPanel({
  settings,
  categories,
  streams,
  canAdminister,
  onSaveSettings,
  flash,
  onClose,
}: Props) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState<Busy>("idle");
  const [showOwn, setShowOwn] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  // Who else is here (issue 045). Empty on a deployment with no accounts, which is what hides the
  // section on desktop and LAN installs — there are no roles there to manage.
  const [people, setPeople] = useState<Person[]>([]);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  // Invites and devices (issue 046). The invite list is the record of who has been let in and who
  // still holds an unspent link; `fresh` is the one link this browser has just generated.
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [inviteRole, setInviteRole] = useState<Person["role"]>("user");
  // The id travels with the link so withdrawing some *other* invite does not wipe it off screen.
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null);
  // Which person's devices are expanded, and what they are. Fetched on demand: an admin opens
  // this to answer one question — "which of these is the phone I lost" — and not otherwise.
  const [openDevices, setOpenDevices] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  // Whose devices the newest fetch was for. Two quick clicks race, and the loser must not paint
  // one person's sessions under another's name — "Sign out" there would hit the wrong account.
  const devicesFor = useRef<string | null>(null);
  // Keys for machines, and the evidence for ending grace mode (issue 047). `freshKey` is the one
  // key this browser has just minted — the server keeps only a hash, so this is its only copy.
  const [machines, setMachines] = useState<DeviceTokenSummary[]>([]);
  const [machineName, setMachineName] = useState("");
  const [freshKey, setFreshKey] = useState<{ id: string; name: string; token: string } | null>(null);
  const [grace, setGrace] = useState<GraceReadout | null>(null);
  // The audit log (issue 050). Opens on the account and role changes, because those are what
  // someone comes looking for — "X changed the title" is routine, "X made Y an admin" is not.
  const [auditEntries, setAuditEntries] = useState<AuditEntry[] | null>(null);
  const [auditNotableOnly, setAuditNotableOnly] = useState(true);
  useEscape(busy === "idle" ? onClose : () => {});

  const loadStatus = () => api.setup.status().then(setStatus).catch(() => {});
  useEffect(() => {
    void loadStatus();
  }, []);

  const loadPeople = () =>
    api.people
      .list()
      .then((r) => setPeople(r.accounts))
      // A user never gets here (the section is admin-only), so a failure means the server said no
      // or is unreachable: show no section rather than an error nobody can act on.
      .catch(() => setPeople([]));
  useEffect(() => {
    if (canAdminister) void loadPeople();
  }, [canAdminister]);

  /**
   * Changes someone's role. The server is the authority on whether it is allowed — the last-admin
   * refusal in particular — so the list is re-read either way rather than patched optimistically:
   * a select that shows a change the server refused is a lie the operator acts on later.
   */
  const changeRole = async (person: Person, role: Person["role"]) => {
    setSavingRole(person.id);
    try {
      await api.people.setRole(person.id, role);
      flash(role === "admin" ? `${person.name} is now an admin` : `${person.name} is now a user`);
    } catch (e) {
      flash((e as Error).message, "err");
    } finally {
      setSavingRole(null);
      await loadPeople();
    }
  };

  const loadMachines = () =>
    Promise.all([api.machines.list(), api.machines.grace()])
      .then(([m, g]) => {
        setMachines(m.tokens);
        setGrace(g);
      })
      // A user never gets here (the section is admin-only), so a failure means the server said no
      // or is unreachable: show no section rather than an error nobody can act on.
      .catch(() => {
        setMachines([]);
        setGrace(null);
      });
  useEffect(() => {
    if (canAdminister) void loadMachines();
  }, [canAdminister]);

  /**
   * Reads the log. Admin-only on the server, so a user is never asked to make a request that
   * answers 403 — the section, and the call, exist only for an admin.
   */
  useEffect(() => {
    if (!canAdminister) return;
    let live = true;
    void api.audit
      .list({ limit: AUDIT_LIMIT, notable: auditNotableOnly })
      // A filter switched twice in quick succession must not let the slower answer paint over
      // the newer one — the rows would then disagree with the button that is pressed.
      .then((r) => {
        if (live) setAuditEntries(r.entries);
      })
      .catch(() => {
        if (live) setAuditEntries([]);
      });
    return () => {
      live = false;
    };
  }, [canAdminister, auditNotableOnly]);

  /**
   * Mints a key and shows it. It is in the response and nowhere else, so it is held in state
   * until this panel closes and the admin is told plainly that it will not come back.
   */
  const createMachine = async () => {
    try {
      const created = await api.machines.create(machineName.trim());
      setFreshKey({
        id: created.device.id,
        name: created.device.name,
        token: created.token,
      });
      setMachineName("");
      flash(`Key created for ${created.device.name} — copy it before you close this`);
    } catch (e) {
      flash((e as Error).message, "err");
    } finally {
      await loadMachines();
    }
  };

  /**
   * Revokes a key. Confirmed first, because this one is not undoable in the way removing a person
   * is: there is no key to put back, and the machine holding it stops working mid-show.
   */
  const revokeMachine = async (machine: DeviceTokenSummary) => {
    if (!window.confirm(`Revoke the key for ${machine.name}? That machine stops working at once.`)) {
      return;
    }
    try {
      await api.machines.revoke(machine.id);
      if (freshKey?.id === machine.id) setFreshKey(null);
      flash(`${machine.name} revoked`);
    } catch (e) {
      flash((e as Error).message, "err");
    } finally {
      await loadMachines();
    }
  };

  const loadInvites = () =>
    api.people
      .invites()
      .then((r) => setInvites(r.invites))
      .catch(() => setInvites([]));
  useEffect(() => {
    if (canAdminister) void loadInvites();
  }, [canAdminister]);

  /**
   * Generates an invite and shows the link. The token is in the response and nowhere else — the
   * server cannot be asked for it again — so it is held in state until this panel closes and the
   * admin is told plainly that it will not come back.
   */
  const createInvite = async () => {
    try {
      const created = await api.people.invite(inviteRole);
      setFresh({ id: created.invite.id, url: `${window.location.origin}${created.path}` });
      flash("Invite created — copy the link before you close this");
    } catch (e) {
      flash((e as Error).message, "err");
    } finally {
      await loadInvites();
    }
  };

  const cancelInvite = async (id: string) => {
    try {
      await api.people.cancelInvite(id);
      // Only the withdrawn invite's own link is unusable now; another one still needs sending.
      setFresh((f) => (f?.id === id ? null : f));
      flash("Invite withdrawn");
    } catch (e) {
      flash((e as Error).message, "err");
    } finally {
      await loadInvites();
    }
  };

  /**
   * Removes someone. Confirmed first, and named in the confirmation: this signs every one of
   * their devices out on the next request and cannot be undone by re-adding them — the new
   * account would be a different one.
   */
  const removePerson = async (person: Person) => {
    if (
      !window.confirm(
        `Remove ${person.name}? They are signed out everywhere immediately, and getting back in ` +
          `means a new invite.`,
      )
    )
      return;
    try {
      await api.people.remove(person.id);
      flash(`${person.name} removed`);
    } catch (e) {
      flash((e as Error).message, "err");
    } finally {
      setOpenDevices(null);
      devicesFor.current = null;
      await loadPeople();
    }
  };

  /** Opens (or closes) one person's device list, fetching it fresh each time it opens. */
  const toggleDevices = async (person: Person) => {
    if (openDevices === person.id) {
      setOpenDevices(null);
      devicesFor.current = null;
      return;
    }
    setOpenDevices(person.id);
    setDevices([]);
    devicesFor.current = person.id;
    try {
      const { sessions } = await api.people.sessions(person.id);
      if (devicesFor.current === person.id) setDevices(sessions);
    } catch (e) {
      flash((e as Error).message, "err");
    }
  };

  const revokeDevice = async (person: Person, sessionId: string) => {
    try {
      await api.people.revokeSession(person.id, sessionId);
      flash(`Signed one of ${person.name}'s devices out`);
      const { sessions } = await api.people.sessions(person.id);
      if (devicesFor.current === person.id) setDevices(sessions);
    } catch (e) {
      flash((e as Error).message, "err");
    }
  };

  const view = status ? describeConnection(status) : null;
  const working = busy !== "idle";

  // Re-run the loopback consent flow against whichever client is already stored (bundled or the
  // operator's own) — reconnect needs no re-entry of the secret, which never left the server.
  const runConnect = async (override?: { clientId: string; clientSecret: string }) => {
    setBusy("connecting");
    try {
      await api.setup.connect(override);
      setBusy("waiting");
      await settle((s) => s.configured);
      await loadStatus();
      setShowOwn(false);
      setClientId("");
      setClientSecret("");
      flash("YouTube connected");
    } catch (e) {
      flash((e as Error).message, "err");
    } finally {
      setBusy("idle");
    }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect this YouTube channel? The saved sign-in is discarded and the app returns to setup.")) {
      return;
    }
    setBusy("disconnecting");
    try {
      await api.setup.disconnect();
      // The server reboots into setup mode — wait for it to report not-configured, then refresh.
      await settle((s) => !s.configured);
      await loadStatus();
      flash("YouTube disconnected");
    } catch (e) {
      flash((e as Error).message, "err");
    } finally {
      setBusy("idle");
    }
  };

  return (
    <div className="overlay" onClick={busy === "idle" ? onClose : undefined}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings__head">
          <span className="eyebrow">Settings</span>
          <h2>Connection &amp; defaults</h2>
          <button className="settings__x" type="button" onClick={onClose} aria-label="Close settings" disabled={working}>
            ✕
          </button>
        </div>

        {/* ---- Connection ---- */}
        <section className="settings__section">
          <h3 className="settings__title">YouTube connection</h3>

          {view == null ? (
            <p className="empty" style={{ marginTop: 0 }}>Checking connection…</p>
          ) : (
            <>
              <div className="conn">
                <span className={`lamp ${view.connected ? "lamp--live" : "lamp--warn"}`} />
                <div className="conn__meta">
                  <span className="conn__state">{view.connected ? "Connected" : "Not connected"}</span>
                  {view.flowLabel ? <span className="conn__flow">via {view.flowLabel}</span> : null}
                </div>
              </div>

              {!canAdminister ? (
                <p className="empty conn__guidance">
                  Only an admin can change the YouTube connection.
                </p>
              ) : view.editable ? (
                <div className="settings__actions">
                  {view.connected ? (
                    <>
                      <button className="btn btn--sm" onClick={() => runConnect()} disabled={working}>
                        {busy === "connecting"
                          ? "Waiting for your browser…"
                          : busy === "waiting"
                            ? "Finishing up…"
                            : "Reconnect"}
                      </button>
                      <button className="btn btn--sm btn--danger" onClick={disconnect} disabled={working}>
                        {busy === "disconnecting" ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </>
                  ) : (
                    <button className="btn btn--primary btn--sm" onClick={() => runConnect()} disabled={working}>
                      {busy === "connecting"
                        ? "Waiting for your browser…"
                        : busy === "waiting"
                          ? "Finishing up…"
                          : "Connect YouTube"}
                    </button>
                  )}
                </div>
              ) : (
                <p className="empty conn__guidance">
                  This connection is managed outside the app — set{" "}
                  <span className="mono">YT_CLIENT_ID</span>, <span className="mono">YT_CLIENT_SECRET</span> and{" "}
                  <span className="mono">YT_REFRESH_TOKEN</span> in the environment, or run the token script, then
                  restart. See the{" "}
                  <a className="settings__link" href="/guide" target="_blank" rel="noreferrer">
                    operator guide
                  </a>
                  .
                </p>
              )}

              {view.editable && canAdminister ? (
                <>
                  <button
                    className="settings__disclosure"
                    type="button"
                    onClick={() => setShowOwn((v) => !v)}
                    disabled={working}
                  >
                    {showOwn ? "Hide" : "Use my own Google client instead"}
                  </button>
                  {showOwn ? (
                    <form
                      className="settings__own"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void runConnect({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
                      }}
                    >
                      <div className="field">
                        <label htmlFor="set-client-id">Client ID</label>
                        <input
                          id="set-client-id"
                          className="mono"
                          value={clientId}
                          placeholder="xxxxxxxx.apps.googleusercontent.com"
                          onChange={(e) => setClientId(e.target.value)}
                          disabled={working}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="set-client-secret">Client secret</label>
                        <input
                          id="set-client-secret"
                          className="mono"
                          type="password"
                          value={clientSecret}
                          placeholder="GOCSPX-…"
                          onChange={(e) => setClientSecret(e.target.value)}
                          disabled={working}
                        />
                      </div>
                      {status?.redirectUri ? (
                        <p className="conn__redirect">
                          Add this authorized redirect URI to your client:{" "}
                          <code className="mono">{status.redirectUri}</code>
                        </p>
                      ) : null}
                      <button
                        className="btn btn--primary btn--sm"
                        type="submit"
                        disabled={working || !clientId.trim() || !clientSecret.trim()}
                      >
                        Connect with my client
                      </button>
                    </form>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </section>

        {/* ---- People (issue 045) ---- */}
        {canAdminister && people.length > 0 ? (
          <section className="settings__section">
            <h3 className="settings__title">People</h3>
            <p className="empty" style={{ marginTop: 0 }}>
              Everyone here can run the show. An admin also manages people and the YouTube
              connection.
            </p>
            <ul className="people">
              {people.map((person) => (
                <li className="people__row" key={person.id}>
                  <span className="people__name">
                    {person.name}
                    {person.seeded ? <span className="people__tag">set up at install</span> : null}
                  </span>
                  <span className="people__actions">
                    <select
                      className="people__role"
                      aria-label={`Role for ${person.name}`}
                      value={person.role}
                      disabled={savingRole === person.id}
                      onChange={(e) => void changeRole(person, e.target.value as Person["role"])}
                    >
                      <option value="admin">Admin</option>
                      <option value="user">User</option>
                    </select>
                    <button
                      className="btn btn--ghost btn--sm"
                      type="button"
                      aria-expanded={openDevices === person.id}
                      onClick={() => void toggleDevices(person)}
                    >
                      Devices
                    </button>
                    {/* The seeded admin has no remove button at all rather than one that answers
                        403: the server refuses it, and a button that always fails is worse than
                        no button. */}
                    {person.seeded ? null : (
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        onClick={() => void removePerson(person)}
                      >
                        Remove
                      </button>
                    )}
                  </span>
                  {openDevices === person.id ? (
                    <ul className="devices">
                      {devices.length === 0 ? (
                        <li className="devices__row">Not signed in on any device.</li>
                      ) : (
                        devices.map((device) => (
                          <li className="devices__row" key={device.id}>
                            <span>
                              Signed in {formatDay(device.createdAt)} · last used{" "}
                              {formatDay(device.lastSeenAt)}
                            </span>
                            <button
                              className="btn btn--ghost btn--sm"
                              type="button"
                              onClick={() => void revokeDevice(person, device.id)}
                            >
                              Sign out
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>

            {/* ---- Invites (issue 046) ---- */}
            <h3 className="settings__title" style={{ marginTop: 20 }}>
              Invites
            </h3>
            <p className="empty" style={{ marginTop: 0 }}>
              Nothing is emailed. Create a link, then send it to that person however you normally
              would. It works once and expires within a day.
            </p>
            <div className="field--row" style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor="invite-role">Role</label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Person["role"])}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="field">
                <label>&nbsp;</label>
                <button className="btn" type="button" onClick={() => void createInvite()}>
                  Create invite link
                </button>
              </div>
            </div>

            {fresh ? (
              <div className="invite-link">
                <span className="invite-link__url">{fresh.url}</span>
                <button
                  className="btn btn--ghost"
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(fresh.url)}
                >
                  Copy
                </button>
              </div>
            ) : null}
            {fresh ? (
              <p className="hint" style={{ marginTop: 6 }}>
                Copy this now — the link is not shown again. Losing it means creating another.
              </p>
            ) : null}

            {invites.length > 0 ? (
              <ul className="invites">
                {invites.map((invite) => (
                  <li
                    className={`invites__row${invite.state === "open" ? "" : " invites__row--spent"}`}
                    key={invite.id}
                  >
                    <span>
                      {invite.role === "admin" ? "Admin" : "User"}
                      <span className="invites__meta">
                        {" · "}
                        {invite.state === "redeemed"
                          ? `used by ${invite.redeemedBy ?? "someone since removed"}`
                          : invite.state === "expired"
                            ? "expired"
                            : `expires ${formatDay(invite.expiresAt)}`}
                      </span>
                    </span>
                    {invite.state === "open" ? (
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        onClick={() => void cancelInvite(invite.id)}
                      >
                        Withdraw
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {/* ---- Machines (issue 047) ---- */}
        {canAdminister && people.length > 0 ? (
          <section className="settings__section">
            <h3 className="settings__title">Machines</h3>
            <p className="empty" style={{ marginTop: 0 }}>
              Companion runs unattended, so it signs in with a key instead of a password. A key can
              run the show and nothing else — it can never manage people or the YouTube connection.
            </p>

            {grace ? (
              <div className={`grace${grace.met ? " grace--met" : ""}`}>
                <p className="grace__lede">
                  {grace.enforcing
                    ? "A key is required. Anything without one is refused."
                    : grace.lastTokenlessAt
                      ? "Something is still connecting without a key."
                      : "Nothing has connected without a key."}
                </p>
                {/* Two gauges, never one verdict. A fortnight of quiet on its own is not evidence:
                    an off-season satisfies it while a keyless machine sits powered down, and the
                    next show goes dark. Both halves are on screen so neither can be read alone. */}
                <div className="grace__gauges">
                  <div
                    className={`grace__gauge${
                      grace.daysSinceTokenless === null ||
                      grace.daysSinceTokenless >= grace.daysRequired
                        ? " grace__gauge--held"
                        : ""
                    }`}
                  >
                    <span className="grace__gauge-label">Quiet days</span>
                    <span className="grace__gauge-value">
                      {grace.daysSinceTokenless === null ? (
                        "none seen"
                      ) : (
                        <>
                          {grace.daysSinceTokenless}
                          <span className="grace__gauge-of"> / {grace.daysRequired}</span>
                        </>
                      )}
                    </span>
                  </div>
                  <div
                    className={`grace__gauge${
                      grace.goLivesSinceTokenless >= grace.goLivesRequired
                        ? " grace__gauge--held"
                        : ""
                    }`}
                  >
                    <span className="grace__gauge-label">Go-lives since</span>
                    <span className="grace__gauge-value">
                      {grace.goLivesSinceTokenless}
                      <span className="grace__gauge-of"> / {grace.goLivesRequired}</span>
                    </span>
                  </div>
                </div>
                <p className="grace__verdict">{graceVerdict(grace)}</p>
                {grace.lastTokenlessAt ? (
                  <p className="grace__last">
                    Last on {formatDay(grace.lastTokenlessAt)} ·{" "}
                    {grace.lastTokenlessClient ?? "unnamed client"}
                    {grace.lastTokenlessFrom ? ` · ${grace.lastTokenlessFrom}` : ""}
                    {grace.lastTokenlessRoute ? ` · ${grace.lastTokenlessRoute}` : ""} ·{" "}
                    {grace.tokenlessCount} in total
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="field--row" style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor="machine-name">Machine name</label>
                <input
                  id="machine-name"
                  value={machineName}
                  placeholder="companion machine"
                  onChange={(e) => setMachineName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>&nbsp;</label>
                <button
                  className="btn"
                  type="button"
                  disabled={!machineName.trim()}
                  onClick={() => void createMachine()}
                >
                  Create key
                </button>
              </div>
            </div>

            {freshKey ? (
              <>
                <div className="invite-link">
                  <span className="invite-link__url">{freshKey.token}</span>
                  <button
                    className="btn btn--ghost"
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(freshKey.token)}
                  >
                    Copy
                  </button>
                </div>
                <p className="hint" style={{ marginTop: 6 }}>
                  Copy this now — the key is not shown again. Paste it into {freshKey.name}&rsquo;s
                  Companion module settings. Losing it means revoking this key and creating another.
                </p>
              </>
            ) : null}

            {machines.length > 0 ? (
              <ul className="invites">
                {machines.map((machine) => (
                  <li
                    className={`invites__row${machine.revokedAt ? " invites__row--spent" : ""}`}
                    key={machine.id}
                  >
                    <span>
                      {machine.name}
                      <span className="invites__meta">
                        {" · "}
                        {machine.revokedAt
                          ? `revoked ${formatDay(machine.revokedAt)}`
                          : machine.lastUsedAt
                            ? `last used ${formatDay(machine.lastUsedAt)}`
                            : "never used"}
                      </span>
                    </span>
                    {machine.revokedAt ? null : (
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        onClick={() => void revokeMachine(machine)}
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {/* ---- Audit log (issue 050) ---- */}
        {canAdminister && people.length > 0 ? (
          <section className="settings__section">
            <h3 className="settings__title">Audit log</h3>
            <p className="empty" style={{ marginTop: 0 }}>
              Who did what, kept on disk for {AUDIT_RETENTION_DAYS} days. Separate from Activity,
              which is a live feed and starts fresh whenever the server restarts.
            </p>

            {/* The same chips the Activity feed filters with — this is the feed's sibling, and a
                second filter idiom on the same screen would read as a different kind of control.
                Two chips rather than a checkbox: it is which log you are reading, not an option
                applied to one. The narrow view is first, because it is the question. */}
            <div className="audit__filter" role="group" aria-label="Which entries to show">
              <button
                className={`chip ${auditNotableOnly ? "chip--on" : ""}`}
                type="button"
                aria-pressed={auditNotableOnly}
                onClick={() => setAuditNotableOnly(true)}
              >
                Account changes
              </button>
              <button
                className={`chip ${auditNotableOnly ? "" : "chip--on"}`}
                type="button"
                aria-pressed={!auditNotableOnly}
                onClick={() => setAuditNotableOnly(false)}
              >
                Everything
              </button>
            </div>

            {auditEntries === null ? null : auditEntries.length === 0 ? (
              <p className="hint" style={{ marginTop: 10 }}>
                {auditNotableOnly
                  ? "No account or role changes recorded yet."
                  : "Nothing recorded yet."}
              </p>
            ) : (
              <ol className="audit">
                {auditEntries.map((item) => (
                  <li
                    className={`audit__row audit__row--${item.outcome}${
                      item.notable ? " audit__row--notable" : ""
                    }`}
                    key={item.id}
                  >
                    <span className="audit__when">{formatMoment(item.ts)}</span>
                    <span className="audit__who">{item.actor.name}</span>
                    <span className="audit__what">
                      {item.action}
                      {item.target ? <span className="audit__target">{item.target}</span> : null}
                    </span>
                    {item.outcome === "ok" ? null : (
                      <span className="audit__outcome">
                        {item.outcome === "refused" ? "refused" : "failed"}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}

        {/* ---- App defaults ---- */}
        <section className="settings__section">
          <h3 className="settings__title">App defaults</h3>
          <p className="empty" style={{ marginTop: 0 }}>
            Baseline used whenever a preset or ad-hoc update leaves category or stream binding blank.
          </p>
          <div className="field--row" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="set-def-cat">Default category</label>
              <CategorySelect
                id="set-def-cat"
                value={settings.defaultCategory}
                categories={categories}
                blankLabel="— none (leave untouched) —"
                onChange={(value) => onSaveSettings({ ...settings, defaultCategory: value })}
              />
            </div>
            <StreamBindingField
              id="set-def-stream"
              label="Default stream binding"
              value={settings.defaultStreamBoundId}
              streams={streams}
              onCommit={(next) => onSaveSettings({ ...settings, defaultStreamBoundId: next })}
            />
          </div>
          <p className="empty">
            The category saves when you leave the field; the stream binding asks first.
          </p>
        </section>
      </div>
    </div>
  );
}

/** Polls the setup status until `done` holds (the restarted/rebuilt server settled) or it times out. */
async function settle(done: (s: SetupStatus) => boolean, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  await delay(400);
  while (Date.now() < deadline) {
    try {
      const s = await api.setup.status();
      if (done(s)) return;
    } catch {
      /* server mid-restart — keep polling */
    }
    await delay(500);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * What the two counters add up to, in a sentence that names the half still missing (issue 047).
 *
 * Stated rather than left to be inferred from two numbers, because the decision it feeds — turn
 * the requirement on, or wait — is made once, by someone who will not be reading it again.
 */
function graceVerdict(g: GraceReadout): string {
  if (g.enforcing) return "A key is required on every Companion connection.";
  if (g.met) {
    return "Both halves hold. It is safe to require a key — do it on a night that is not a show night, with the operator there.";
  }
  const daysHeld = g.daysSinceTokenless === null || g.daysSinceTokenless >= g.daysRequired;
  if (!daysHeld && g.goLivesSinceTokenless < g.goLivesRequired) {
    return "Not yet. Give every machine a key, then wait — anything that connects without one puts both counts back to zero.";
  }
  if (!daysHeld) {
    return "Not yet: a show has run on a key, but something connected without one more recently.";
  }
  return "Not yet: quiet days alone are not evidence. An off-season fortnight would pass while a keyless machine sat powered down. Waiting on a go-live.";
}

/**
 * A timestamp as a person reads it: "3 Sep". The year is added only when it is not this one, so
 * the common case stays short and the rare case is not ambiguous.
 *
 * These stamps answer "which of these devices is the one I lost" and "how long has this link
 * got", and neither question is decided by the minute — so the time of day is left off.
 */
/** Entries fetched in one read. Ninety days of human actions is small; a page control is not. */
const AUDIT_LIMIT = 200;
/** Mirrors the server's retention window, so the copy cannot promise a month the log does not keep. */
const AUDIT_RETENTION_DAYS = 90;

/**
 * Day and time. The audit log is read to answer "when did that happen", and a date alone cannot
 * separate two changes made the same afternoon.
 */
function formatMoment(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "unknown";
  return `${formatDay(iso)} ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function formatDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "unknown";
  return at.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: at.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}
