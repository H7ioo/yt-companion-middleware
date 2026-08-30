import { useState } from "react";
import { api } from "../api.js";

/**
 * Sign-in for a hosted deployment (issue 043). Shown in place of the whole dashboard when the
 * server reports `authRequired` and nobody is signed in.
 *
 * Visually it is the first-run setup card with a different seam: same centered rack panel, so the
 * app reads as one surface, but blue along the top rather than tally red — this screen is asking
 * the operator to act, not telling them a channel is live.
 */
export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.auth.login(name.trim(), password);
      onSignedIn();
    } catch (err) {
      // The server deliberately says only "incorrect username or password" — pass it through
      // rather than guessing at something friendlier that would leak which half was wrong.
      setError((err as Error).message);
      setPassword("");
      setBusy(false);
    }
  };

  return (
    <div className="setup">
      <form className="setup__card setup__card--auth" onSubmit={submit}>
        <div className="setup__head">
          <span className="eyebrow">Control surface</span>
          <h1 className="setup__title">Sign in</h1>
          <p className="setup__lede">
            This deployment is shared. Sign in so actions on the live channel are attributable to
            the person who made them.
          </p>
        </div>

        {error ? (
          <p className="setup__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="field">
          <label htmlFor="login-name">Username</label>
          <input
            id="login-name"
            value={name}
            autoComplete="username"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="setup__foot setup__foot--auth">
          <button
            className="btn btn--primary"
            type="submit"
            disabled={busy || !name.trim() || !password}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
