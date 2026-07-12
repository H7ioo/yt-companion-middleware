// @ts-check
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HEALTH_GLOSSARY, BROADCAST_STATE } from "@app/shared";
import { healthColor } from "../companion-module/src/transform.js";
import { render, publicDir, rgbString } from "./docs-dom.mjs";

/**
 * The layouts page (PRD-08 §3, issue 037) shows suggested Stream Deck arrangements as *working*
 * button faces: the reader flips mock state — go live, degrade, go offline, get busy — and watches
 * the keys react the way the real deck will.
 *
 * Two things can rot here, and both are tested against their canonical source rather than by eye:
 *
 *   1. **It must never touch the API.** It's a picture of a deck, not a deck. A `fetch` in here
 *      would spend YouTube quota every time someone opened the manual.
 *   2. **The colours and words must be the real ones.** A guide that shows `degraded` as grey, or
 *      calls On Air "Live", teaches the operator a product that doesn't exist. So the assertions
 *      below import the same `healthColor()` the Companion module ships and the same glossary the
 *      dashboard renders from — if the page drifts off either, this fails.
 */
const layoutsJs = fs.readFileSync(path.join(publicDir, "guide", "assets", "layouts.js"), "utf8");

/** Drive the page's mock-state controls the way a reader would: by clicking them. */
function open() {
  const { doc, errors } = render("guide/layouts.html");
  expect(errors).toEqual([]);
  const click = (/** @type {string} */ sel) => {
    const el = doc.querySelector(sel);
    expect([sel, Boolean(el)]).toEqual([sel, true]);
    /** @type {any} */ (el).click();
  };
  /** The rendered face of a key, in whichever layout carries it. */
  const key = (/** @type {string} */ id) => {
    const el = /** @type {HTMLElement | null} */ (doc.querySelector(`.key[data-key="${id}"]`));
    expect([id, Boolean(el)]).toEqual([id, true]);
    return /** @type {HTMLElement} */ (el);
  };
  return { doc, click, key };
}

describe("layouts page never calls the API", () => {
  it("has no network primitive in it at all — the widgets run on mock state", () => {
    for (const api of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "navigator.send"]) {
      expect([api, layoutsJs.includes(api)]).toEqual([api, false]);
    }
  });

  it("ships a mock state object as the only source the faces read", () => {
    expect(layoutsJs).toMatch(/mock/i);
  });
});

describe("layouts page draws suggested arrangements", () => {
  it("renders more than one deck, each as a grid of button faces", () => {
    const { doc } = open();
    const decks = [...doc.querySelectorAll(".deck")];
    expect(decks.length).toBeGreaterThanOrEqual(2);
    for (const deck of decks) {
      expect(deck.getAttribute("data-layout")).toBeTruthy();
      expect(deck.querySelectorAll(".key").length).toBeGreaterThan(0);
    }
  });

  it("shows preset keys, an on-air lamp, a health lamp and a busy lamp", () => {
    const { key } = open();
    for (const id of ["on_air", "health", "busy"]) expect(key(id)).toBeTruthy();
    const { doc } = open();
    expect(doc.querySelectorAll('.key[data-kind="preset"]').length).toBeGreaterThanOrEqual(2);
  });
});

describe("mock state drives the faces client-side", () => {
  it("lights the on-air key red and names the state canonically when the reader goes live", () => {
    const { doc, click, key } = open();
    expect(key("on_air").style.backgroundColor).not.toBe(rgbString(0xc80000));
    click('[data-toggle="live"]');
    // 200,0,0 — the `on_air` feedback style the Companion module ships.
    expect(key("on_air").style.backgroundColor).toBe(rgbString(0xc80000));
    expect(doc.querySelector(".deck-state")?.textContent).toContain(BROADCAST_STATE.live.label);
    click('[data-toggle="live"]');
    expect(doc.querySelector(".deck-state")?.textContent).toContain(BROADCAST_STATE.idle.label);
  });

  it("recolours the health lamp to the canonical colour of every health state", () => {
    const { click, key } = open();
    for (const state of /** @type {const} */ (["ok", "degraded", "offline", "auth_error"])) {
      click(`[data-health="${state}"]`);
      expect([state, key("health").style.backgroundColor]).toEqual([state, rgbString(healthColor(state))]);
      expect(key("health").textContent).toContain(HEALTH_GLOSSARY[state].label);
    }
  });

  it("lights the busy key blue while an action is in flight", () => {
    const { click, key } = open();
    click('[data-toggle="busy"]');
    // 0,80,200 — the `busy` feedback style.
    expect(key("busy").style.backgroundColor).toBe(rgbString(0x0050c8));
  });

  it("highlights the active preset — every key bound to it, and no other preset", () => {
    const { doc, key } = open();
    const presets = [...doc.querySelectorAll('.key[data-kind="preset"]')];
    /** @type {any} */ (presets[0]).click();
    const id = presets[0].getAttribute("data-key") ?? "";
    // 0,140,0 — the `active_preset` highlight style. A layout may carry the same preset on more
    // than one deck; in Companion every key bound to it lights, so here too.
    expect(key(id).style.backgroundColor).toBe(rgbString(0x008c00));
    const lit = presets.filter(
      (p) => /** @type {HTMLElement} */ (p).style.backgroundColor === rgbString(0x008c00),
    );
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.every((p) => p.getAttribute("data-key") === id)).toBe(true);
  });
});

describe("layouts page joins the guide", () => {
  it("is in the shared page manifest, so the sidebar and pager carry it", () => {
    const nav = fs.readFileSync(path.join(publicDir, "guide", "assets", "nav.js"), "utf8");
    expect(nav).toContain("layouts.html");
    const { doc } = open();
    expect([...doc.querySelectorAll("nav.toc a")].length).toBeGreaterThan(0);
    expect(doc.querySelectorAll("nav.pager a").length).toBeGreaterThan(0);
  });
});
