import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { FillPage } from "./FillPage.js";
import { SetupScreen } from "./components/SetupScreen.js";
import { LoginScreen } from "./components/LoginScreen.js";
import { showLogin } from "./lib/session.js";
import { parseFillRoute } from "./lib/fillRoute.js";
import { api, type SessionInfo } from "./api.js";
import "./styles.css";

// The Companion deep link (`/fill?preset=…&redirect=…`) lands on the same bundle; a plain
// location parse keeps the SPA router-free.
const fill = parseFillRoute(window.location);

/**
 * Gates the dashboard, in the order the gates actually apply.
 *
 * Sign-in comes first (issue 043): on a hosted deployment the person who finishes setup is the
 * person who has to sign in, so the login screen sits in front of the setup screen. It is skipped
 * entirely when the server reports no accounts — the desktop and LAN installs — where a login
 * screen would be a locked door with no key.
 *
 * Then first-run setup: until the server has YouTube credentials it can't serve any dashboard
 * data. The fill deep link bypasses both — it renders its own minimal page.
 */
function Root() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  // Tracked separately from `session`, because "not signed in" and "not asked yet" are both null:
  // without this the dashboard renders for an instant before the login screen replaces it.
  const [askedWhoIAm, setAskedWhoIAm] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    api.auth
      .me()
      .then(setSession)
      // An unreachable /me must not lock the dashboard out; the deployments that authenticate are
      // the ones that answer it.
      .catch(() => setSession(null))
      .finally(() => setAskedWhoIAm(true));
    api.setup
      .status()
      .then((s) => setConfigured(s.configured))
      // If the probe itself fails, assume configured and let the dashboard surface the error.
      .catch(() => setConfigured(true));
  }, []);

  if (configured === null || !askedWhoIAm) return <div className="boot">Starting…</div>;
  if (showLogin(session)) {
    // Reload rather than patching state: every panel below fetches on mount, and the browser now
    // carries a cookie it did not have a moment ago.
    return <LoginScreen onSignedIn={() => window.location.reload()} />;
  }
  if (!configured) return <SetupScreen onReady={() => setConfigured(true)} />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{fill ? <FillPage route={fill} /> : <Root />}</StrictMode>,
);
