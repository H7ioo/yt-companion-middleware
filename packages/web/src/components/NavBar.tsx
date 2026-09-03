import { NavLink } from "react-router";
import { NAV_PAGES } from "../lib/nav.js";

/**
 * The rack's channel strip: one lit tab per page, across the top of the content column.
 *
 * Built as tabs rather than a sidebar list because the status rail already owns the left edge and
 * must keep it — the tally lamp is the thing an operator glances at mid-show, and nothing may
 * push it off screen. The active tab lights its top bezel and lifts onto the panel surface, so
 * "where am I" reads the same way the breaker and the tally do: by what is illuminated.
 *
 * The Live tab carries its own lamp. It is the one page whose state changes without anyone
 * clicking, and an operator two tabs away still has to see the moment the channel goes on air.
 */
export function NavBar({ isLive }: { isLive: boolean }) {
  return (
    <nav className="nav" aria-label="Dashboard sections">
      {NAV_PAGES.map((page) => (
        <NavLink
          key={page.path}
          to={page.path}
          // `end` only on the index route: without it "/" matches every path and every tab lights.
          end={page.path === "/"}
          title={page.hint}
          className={({ isActive }) => `nav__tab${isActive ? " nav__tab--on" : ""}`}
        >
          {page.path === "/" ? (
            <span className={`lamp ${isLive ? "lamp--live" : "lamp--ready"}`} aria-hidden="true" />
          ) : null}
          {page.label}
        </NavLink>
      ))}
    </nav>
  );
}
