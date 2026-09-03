// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { NavBar } from "./NavBar.js";
import { NAV_PAGES } from "../lib/nav.js";

afterEach(cleanup);

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <NavBar isLive={false} />
    </MemoryRouter>,
  );

describe("NavBar", () => {
  it("offers a way into every page the router serves", () => {
    at("/");
    for (const page of NAV_PAGES) {
      const tab = screen.getByRole("link", { name: new RegExp(page.label) });
      expect(tab.getAttribute("href")).toBe(page.path);
    }
  });

  it("lights the tab for the page being shown", () => {
    at("/presets");
    expect(screen.getByRole("link", { name: /Presets/ }).className).toContain("nav__tab--on");
    expect(screen.getByRole("link", { name: /Settings/ }).className).not.toContain("nav__tab--on");
  });

  // Without `end` on the index route, "/" is a prefix of every path and every tab lights at once.
  it("lights Live only on Live, not on every page under it", () => {
    at("/schedule");
    expect(screen.getByRole("link", { name: /Live/ }).className).not.toContain("nav__tab--on");
  });

  it("carries the tally on the Live tab, so going on air is visible from another page", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/activity"]}>
        <NavBar isLive />
      </MemoryRouter>,
    );
    expect(container.querySelector(".nav__tab .lamp--live")).not.toBeNull();
  });
});
