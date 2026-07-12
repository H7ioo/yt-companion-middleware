// @ts-check
import { describe, it, expect } from "vitest";
import { HEALTH_GLOSSARY } from "@app/shared";
import { healthColor } from "../companion-module/src/transform.js";

/**
 * The Companion module ships standalone and cannot import @app/shared at runtime, so its health
 * colour table (transform.js HEALTH_COLORS) is a hand-maintained copy. This is that copy's teeth:
 * the module's `healthColor()` must resolve every glossary state to the packed RGB its canonical
 * `keyColor` names — recolour a state in the glossary and miss the Companion, and this fails in CI
 * instead of shipping a Stream Deck key that contradicts the dashboard (the drift issue 021 exists
 * to kill).
 *
 * The keyColor → RGB correspondence is defined once here. It is the single seam that binds the
 * glossary's named key colours to the concrete pixels the deck lights; changing a value here is a
 * deliberate palette decision, not incidental.
 */
const rgb = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) =>
  (r << 16) | (g << 8) | b;

/** @type {Record<string, number>} */
const KEY_COLOR_RGB = {
  Green: rgb(0, 140, 0),
  Yellow: rgb(200, 120, 0),
  Grey: rgb(90, 98, 112),
  Red: rgb(200, 0, 0),
};

describe("companion health colours match the glossary key colours (issue 021 / PRD-11)", () => {
  for (const [state, term] of Object.entries(HEALTH_GLOSSARY)) {
    it(`${state} lights ${term.keyColor}`, () => {
      const expected = KEY_COLOR_RGB[term.keyColor];
      expect([state, expected]).not.toEqual([state, undefined]);
      expect([state, healthColor(state)]).toEqual([state, expected]);
    });
  }

  it("every canonical key colour has a defined RGB (the map covers the glossary's palette)", () => {
    for (const term of Object.values(HEALTH_GLOSSARY)) {
      expect([term.keyColor, term.keyColor in KEY_COLOR_RGB]).toEqual([term.keyColor, true]);
    }
  });

  it("an unknown state falls back to a neutral, never to a real key colour", () => {
    const fallback = healthColor("not_a_state");
    expect(Object.values(KEY_COLOR_RGB)).not.toContain(fallback);
  });
});
