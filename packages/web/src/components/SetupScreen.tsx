import { useEffect, useState } from "react";
import type { ConnectMode } from "@app/shared";
import { api } from "../api.js";
import { clearConnectReturn, readConnectReturn } from "../lib/connectReturn.js";

/**
 * First-run setup. Consent runs one of two ways, and the server says which (issue 052):
 *
 * - `in-app` — the desktop build. The server opens the real Google consent screen in the *system*
 *   browser and captures the refresh token to its own store; this request stays open meanwhile.
 * - `redirect` — a hosted deployment. Nothing here can open a browser, but the one already reading
 *   this page will do: it is sent to Google and returns through the server's public callback, so
 *   the outcome arrives as a query string on a fresh page load rather than as a resolved promise.
 *
 * Either way no refresh token is ever pasted by hand. Only when neither flow is available — a
 * headless host that does not know its public origin — do the three-credential fields appear, and
 * the token has to come from `scripts/get-refresh-token.mjs`.
 */
export function SetupScreen({ onReady }: { onReady: () => void }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [status, setStatus] = useState<"idle" | "connecting" | "saving" | "waiting">("idle");
  const [error, setError] = useState<string | null>(null);
  // How consent can run here, if at all, and whether a bundled client ships with this build.
  const [connectMode, setConnectMode] = useState<ConnectMode | null>(null);
  const [hasBundled, setHasBundled] = useState(false);
  // The redirect URI to register on the operator's own OAuth client — loopback on a desktop
  // host, the public callback on a hosted one. The server decides which; it is shown verbatim.
  const [redirectUri, setRedirectUri] = useState("");
  // Manual fields start hidden when one-click is available; the disclosure reveals them.
  const [manual, setManual] = useState(false);

  useEffect(() => {
    api.setup
      .status()
      .then((s) => {
        setConnectMode(s.connectMode);
        setHasBundled(s.hasBundledClient);
        setRedirectUri(s.redirectUri);
        // No one-click path here — go straight to the credential form.
        if (!s.connectMode || !s.hasBundledClient) setManual(true);
      })
      .catch(() => setManual(true));
  }, []);

  // The hosted flow's failures come back on the URL, not from a promise: the browser left this
  // page for Google and returned to a fresh mount. A success needs nothing here — the server is
  // configured by then, so the gate above this screen renders the dashboard instead.
  useEffect(() => {
    const returned = readConnectReturn(new URL(window.location.href));
    if (returned && !returned.ok) setError(returned.message);
    clearConnectReturn();
  }, []);

  const busy = status !== "idle";

  /**
   * Runs consent whichever way this host can. `override` carries the operator's own client when
   * they are supplying one; omitted, the bundled client is used. On the redirect flow this
   * function does not return in the normal case — the browser leaves for Google.
   */
  const runConnect = async (override?: { clientId: string; clientSecret: string }) => {
    setError(null);
    setStatus("connecting");
    try {
      if (connectMode === "redirect") {
        const { url } = await api.setup.authorize(override);
        window.location.assign(url);
        return;
      }
      // The server holds this request open while the user approves in the system browser.
      await api.setup.connect(override);
      setStatus("waiting");
      await waitForReady();
      onReady();
    } catch (err) {
      setError((err as Error).message);
      setStatus("idle");
    }
  };

  const connect = () => runConnect();

  // Override (PRD-03 §3): consent against the operator's own client. Only the client ID/secret are
  // entered — the flow itself fetches the refresh token; nothing is pasted.
  const connectOwn = () =>
    runConnect({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });

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

  const oneClick = connectMode !== null && hasBundled;
  // The redirect flow's button leaves the page, so it says where it is going rather than claiming
  // to be waiting on something. "Waiting for your browser" would be a lie on a host with none.
  const leaving = connectMode === "redirect";

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
              {status === "connecting" && !leaving
                ? "Waiting for your browser…"
                : status === "waiting"
                  ? "Finishing up…"
                  : "Connect YouTube"}
            </button>
            <p className="setup__connect-hint">
              {leaving
                ? "Takes you to Google to choose your channel, then brings you back here. You may see a “Google hasn’t verified this app” screen — that’s expected."
                : "Opens Google in your browser. You may see a “Google hasn’t verified this app” screen — that’s expected; choose your channel and continue."}
            </p>
          </div>
        ) : null}

        {oneClick && !manual ? (
          <button className="setup__disclosure" type="button" onClick={() => setManual(true)}>
            Use my own credentials instead
          </button>
        ) : null}

        {manual && connectMode ? (
          // A host that can run consent: enter only the client ID/secret; the flow fetches the
          // refresh token itself, whether it drives the browser or hands this one a URL.
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
                {status === "connecting" && !leaving
                  ? "Waiting for your browser…"
                  : status === "waiting"
                    ? "Finishing up…"
                    : leaving
                      ? "Continue to Google"
                      : "Connect with my client"}
              </button>
            </div>
          </form>
        ) : null}

        {manual && !connectMode ? (
          // No browser to drive and no public origin to be returned to, so the refresh token is
          // pasted directly (the CLI script produces it). Saving restarts the server.
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
