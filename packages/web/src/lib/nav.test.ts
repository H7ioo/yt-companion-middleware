// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { NAV_PAGES } from "./nav.js";
import { router } from "../routes.js";

/**
 * One list feeds the navbar and one array feeds the router, and the pairing is the whole point
 * of `NAV_PAGES` — a page with a route and no tab is dead code, and a tab with no route is a
 * dead end. Asserted rather than trusted, because the two live in different files.
 */
const routed = new Set(
  (router.routes[0].children ?? []).map((child) =>
    "index" in child && child.index ? "/" : `/${child.path ?? ""}`,
  ),
);

describe("the dashboard's pages", () => {
  it("routes every tab the navbar offers", () => {
    for (const page of NAV_PAGES) expect(routed.has(page.path)).toBe(true);
  });

  it("carries a Broadcasts page, where the collection is managed (issue 069)", () => {
    const page = NAV_PAGES.find((p) => p.path === "/broadcasts");
    expect(page?.label).toBe("Broadcasts");
    expect(page?.hint).toBeTruthy();
  });
});
