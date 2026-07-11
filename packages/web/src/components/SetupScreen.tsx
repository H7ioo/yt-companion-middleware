import { useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * First-run setup for the desktop build. The one-click path opens the real Google consent screen
 * in the system browser and captures the refresh token to the server's store — no token is ever
 * pasted by hand. When no bundled client ships (Docker/override builds) or the operator wants their
 * own client, the manual credential fields are revealed instead. Shown whenever the server reports
 * it is not yet configured.
 */
export function SetupScreen({ onReady }: { onReady: () => void }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [status, setStatus] = useState<"idle" | "connecting" | "saving" | "waiting">("idle");
  const [error, setError] = useState<string | null>(null);
  // Whether the host can run the one-click flow, and whether a bundled client ships with it.
  const [canConnect, setCanConnect] = useState(false);
  const [hasBundled, setHasBundled] = useState(false);
  // The loopback redirect the operator registers on their own OAuth client (override flow).
  const [redirectUri, setRedirectUri] = useState("");
  // Manual fields start hidden when one-click is available; the disclosure reveals them.
  const [manual, setManual] = useState(false);

  useEffect(() => {
    api.setup
      .status()
      .then((s) => {
        setCanConnect(s.canConnect);
        setHasBundled(s.hasBundledClient);
        setRedirectUri(s.redirectUri);
        // No one-click path here — go straight to the manual form (today's behaviour).
        if (!s.canConnect || !s.hasBundledClient) setManual(true);
      })
      .catch(() => setManual(true));
  }, []);

  const busy = status !== "idle";

  const connect = async () => {
    setError(null);
    setStatus("connecting");
    try {
      // The server holds this request open while the user approves in their browser.
      await api.setup.connect();
      setStatus("waiting");
      await waitForReady();
      onReady();
    } catch (err) {
      setError((err as Error).message);
      setStatus("idle");
    }
  };

  // Override (PRD-03 §3): run the in-app OAuth flow against the operator's own client. Only the
  // client ID/secret are entered — the flow itself fetches the refresh token; nothing is pasted.
  const connectOwn = async () => {
    setError(null);
    setStatus("connecting");
    try {
      await api.setup.connect({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
      setStatus("waiting");
      await waitForReady();
      onReady();
    } catch (err) {
      setError((err as Error).message);
      setStatus("idle");
    }
  };

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

  const oneClick = canConnect && hasBundled;

  return (
    <div className="setup">
      <div className="setup__card">
        <div className="setup__head">
          <span className="eyebrow">First-time setup</span>
          <h1 className="setup__title">Connect your YouTube channel</h1>
          <p className="setup__lede">
            Sign in with the Google account that owns the channel this control surface will drive.
            Your credentials stay on this machine and are only used to talk to the YouTube API.
          </p>
        </div>

        {oneClick ? (
          <div className="setup__connect">
            <button
              className="btn btn--primary setup__connect-btn"
              type="button"
              onClick={connect}
              disabled={busy}
            >
              {status === "connecting"
                ? "Waiting for your browser…"
                : status === "waiting"
                  ? "Finishing up…"
                  : "Connect YouTube"}
            </button>
            <p className="setup__connect-hint">
              Opens Google in your browser. You may see a “Google hasn’t verified this app” screen —
              that’s expected; choose your channel and continue.
            </p>
          </div>
        ) : null}

        {oneClick && !manual ? (
          <button className="setup__disclosure" type="button" onClick={() => setManual(true)}>
            Use my own credentials instead
          </button>
        ) : null}

        {manual && canConnect ? (
          // Electron host: enter only the client ID/secret; the in-app flow does the rest.
          <form
            className="setup__manual"
            onSubmit={(e) => {
              e.preventDefault();
              void connectOwn();
            }}
          >
            {oneClick ? <div className="setup__seam">Your own credentials</div> : null}

            <div className="field">
              <label htmlFor="setup-client-id">Client ID</label>
              <input
                id="setup-client-id"
                className="mono"
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

            {redirectUri ? (
              <div className="setup__redirect">
                <span className="setup__redirect-label">Authorized redirect URI — add this to your client</span>
                <code className="setup__redirect-uri">{redirectUri}</code>
              </div>
            ) : null}

            <div className="setup__foot">
              <a className="setup__link" href="/guide" target="_blank" rel="noreferrer">
                Where do I get these?
              </a>
              <button
                className="btn btn--primary"
                type="submit"
                disabled={busy || !clientId.trim() || !clientSecret.trim()}
              >
                {status === "connecting"
                  ? "Waiting for your browser…"
                  : status === "waiting"
                    ? "Finishing up…"
                    : "Connect with my client"}
              </button>
            </div>
          </form>
        ) : null}

        {manual && !canConnect ? (
          // Headless/Docker: no system browser to drive, so the refresh token is pasted directly
          // (the CLI script produces it). Saving restarts the server to wire the client.
          <form className="setup__manual" onSubmit={submit}>
            <div className="field">
              <label htmlFor="setup-client-id">Client ID</label>
              <input
                id="setup-client-id"
                className="mono"
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
        ) : null}

        {error ? <p className="setup__error">{error}</p> : null}
      </div>
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
