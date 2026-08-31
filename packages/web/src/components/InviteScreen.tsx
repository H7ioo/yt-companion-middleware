import { useEffect, useState } from "react";
import { api, type Person } from "../api.js";

/**
 * Redeeming an invite (issue 046). Shown in place of the whole dashboard when someone arrives on
 * `/invite?token=…` — the link an admin generated and handed over.
 *
 * The same rack panel as sign-in and first-run setup, so the app reads as one surface, with the
 * seam in signal green rather than interactive blue: this is the only screen in the app that is
 * *granting* something rather than asking for it or reporting a live channel.
 *
 * The link is checked on arrival, before anything is typed. A dead link that only announces
 * itself after someone has chosen a password twice is the failure this page exists to avoid, and
 * the server answers the same refusal to the check and to the redemption.
 */
export function InviteScreen({ token, onRedeemed }: { token: string; onRedeemed: () => void }) {
  // null while the link is still being checked — "not asked yet" and "no role" are both falsy,
  // and rendering the form during that gap offers a password box that may be about to vanish.
  const [role, setRole] = useState<Person["role"] | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.invite
      .inspect(token)
      .then((r) => setRole(r.role))
      .catch((err: Error) => setDead(err.message));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.invite.redeem(token, name.trim(), password);
      onRedeemed();
    } catch (err) {
      setError((err as Error).message);
      setPassword("");
      setBusy(false);
    }
  };

  if (dead) {
    return (
      <div className="setup">
        <div className="setup__card setup__card--dead">
          <div className="setup__head">
            <span className="eyebrow">Invite</span>
            <h1 className="setup__title">This link cannot be used</h1>
            <p className="setup__lede">{dead}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!role) return <div className="boot">Checking your invite…</div>;

  return (
    <div className="setup">
      <form className="setup__card setup__card--invite" onSubmit={submit}>
        <div className="setup__head">
          <span className="eyebrow">Invite</span>
          <h1 className="setup__title">Set up your sign-in</h1>
          <p className="setup__lede">
            Choose a username and password. Nobody else knows them, and nobody shares a login here.
          </p>
          {/* The one thing the link decides and the invitee cannot: what this account may do.
              Stated up front so the access is understood before it is accepted, not discovered
              later at a button that answers "ask an admin". */}
          <p className="invite__grant">
            <span className="invite__grant-label">This invite grants</span>
            <span className="invite__grant-role">{role === "admin" ? "Admin" : "User"}</span>
            <span className="invite__grant-note">
              {role === "admin"
                ? "Run the show, and manage people and the YouTube connection."
                : "Run the show: presets, titles, going live and ending the stream."}
            </span>
          </p>
        </div>

        {error ? (
          <p className="setup__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="field">
          <label htmlFor="invite-name">Username</label>
          <input
            id="invite-name"
            value={name}
            autoComplete="username"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="invite-password">Password</label>
          <input
            id="invite-password"
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          {/* Stated before it is typed rather than as an error afterwards — the rule is the
              server's and there is no way to guess it from an empty box. */}
          <p className="hint">At least 12 characters.</p>
        </div>

        <div className="setup__foot setup__foot--auth">
          <button
            className="btn btn--primary"
            type="submit"
            disabled={busy || !name.trim() || password.length < 12}
          >
            {busy ? "Setting up…" : "Create account"}
          </button>
        </div>
      </form>
    </div>
  );
}
