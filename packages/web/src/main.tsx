import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { FillPage } from "./FillPage.js";
import { SetupScreen } from "./components/SetupScreen.js";
import { parseFillRoute } from "./lib/fillRoute.js";
import { api } from "./api.js";
import "./styles.css";

// The Companion deep link (`/fill?preset=…&redirect=…`) lands on the same bundle; a plain
// location parse keeps the SPA router-free.
const fill = parseFillRoute(window.location);

/**
 * Gates the dashboard behind first-run setup: until the server has YouTube credentials it can't
 * serve any dashboard data, so we show the setup screen instead. The fill deep link bypasses
 * this — it renders its own minimal page.
 */
function Root() {
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    api.setup
      .status()
      .then((s) => setConfigured(s.configured))
      // If the probe itself fails, assume configured and let the dashboard surface the error.
      .catch(() => setConfigured(true));
  }, []);

  if (configured === null) return <div className="boot">Starting…</div>;
  if (!configured) return <SetupScreen onReady={() => setConfigured(true)} />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{fill ? <FillPage route={fill} /> : <Root />}</StrictMode>,
);
