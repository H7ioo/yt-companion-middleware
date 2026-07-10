import { useState } from "react";
import { api } from "../api.js";

/**
 * First-run setup for the desktop build. Collects the three YouTube OAuth credentials, saves
 * them, then waits for the server to restart with the API wired before handing off to the
 * dashboard. Shown whenever the server reports it is not yet configured.
 */
export function SetupScreen({ onReady }: { onReady: () => void }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "waiting">("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = status !== "idle";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus("saving");
    try {
      await api.setup.save({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        refreshToken: refreshToken.trim(),
      });
      // The server restarts to wire the YouTube client — poll until it reports ready.
      setStatus("waiting");
      await waitForReady();
      onReady();
    } catch (err) {
      setError((err as Error).message);
      setStatus("idle");
    }
  };

  return (
    <div className="setup">
      <form className="setup__card" onSubmit={submit}>
        <div className="setup__head">
          <span className="eyebrow">First-time setup</span>
          <h1 className="setup__title">Connect your YouTube channel</h1>
          <p className="setup__lede">
            Paste the OAuth credentials for the channel this control surface will drive. They
            stay on this machine and are only used to talk to the YouTube API.
          </p>
        </div>

        <div className="field">
          <label htmlFor="setup-client-id">Client ID</label>
          <input
            id="setup-client-id"
            className="mono"
            autoFocus
            value={clientId}
            placeholder="xxxxxxxx.apps.googleusercontent.com"
            onChange={(e) => setClientId(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="setup-client-secret">Client secret</label>
          <input
            id="setup-client-secret"
            className="mono"
            type="password"
            value={clientSecret}
            placeholder="GOCSPX-…"
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="setup-refresh-token">Refresh token</label>
          <input
            id="setup-refresh-token"
            className="mono"
            type="password"
            value={refreshToken}
            placeholder="1//…"
            onChange={(e) => setRefreshToken(e.target.value)}
            disabled={busy}
          />
        </div>

        {error ? <p className="setup__error">{error}</p> : null}

        <div className="setup__foot">
          <a className="setup__link" href="/guide" target="_blank" rel="noreferrer">
            Where do I get these?
          </a>
          <button
            className="btn btn--primary"
            type="submit"
            disabled={busy || !clientId.trim() || !clientSecret.trim() || !refreshToken.trim()}
          >
            {status === "saving"
              ? "Saving…"
              : status === "waiting"
                ? "Connecting…"
                : "Connect channel"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Polls the setup status until the restarted server reports it is configured (or times out). */
async function waitForReady(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Give the server a moment to begin its restart before the first probe.
  await delay(500);
  while (Date.now() < deadline) {
    try {
      const s = await api.setup.status();
      if (s.configured) return;
    } catch {
      /* server mid-restart — keep polling */
    }
    await delay(600);
  }
  throw new Error("Setup saved, but the server did not come back. Restart the app and try again.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
