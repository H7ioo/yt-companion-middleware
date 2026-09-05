import { createBrowserRouter, Navigate } from "react-router";
import { App } from "./App.js";
import { LivePage } from "./pages/LivePage.js";
import { PresetsPage } from "./pages/PresetsPage.js";
import { SchedulePage } from "./pages/SchedulePage.js";
import { BroadcastsPage } from "./pages/BroadcastsPage.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

/**
 * The dashboard's pages, hung off the shell that owns the status rail, the banners and the
 * modals (navbar + pages).
 *
 * Real paths rather than hashes: the server's catch-all already hands `index.html` to anything
 * that is not `/api/` or a built asset, so a reload of `/presets` or a bookmarked `/settings`
 * lands where it says it does. The two router-free routes stay router-free — `/fill` and
 * `/invite` are parsed in main.tsx and answered before this router is ever mounted, because both
 * are gates in front of the dashboard rather than pages within it.
 *
 * Anything unrecognised redirects to Live: a stale bookmark should open the dashboard, not a
 * dead end — and a redirect rather than a render, so the URL matches the page and the navbar has
 * a tab lit for where you are.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <LivePage /> },
      { path: "presets", element: <PresetsPage /> },
      { path: "schedule", element: <SchedulePage /> },
      { path: "broadcasts", element: <BroadcastsPage /> },
      { path: "activity", element: <ActivityPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
