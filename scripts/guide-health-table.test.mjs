// @ts-check
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { HEALTH_GLOSSARY } from "@app/shared";
import { publicDir } from "./docs-dom.mjs";

/**
 * The operator guide's health table (guide/api.html, §07) hand-copies the glossary's meanings and
 * key colours — the guide is static HTML with no build step (see docs-dom.mjs) and can't import
 * @app/shared at runtime. For years that copy was guarded only by a "keep in lockstep" comment,
 * exactly the unenforced-drift class issues 017/021 were opened to kill. This is the enforcement:
 * it parses the shipped table and diffs every row against HEALTH_GLOSSARY, so a glossary reword or
 * recolour that misses the manual fails CI instead of teaching operators a product that changed.
 *
 * Prior art: guide-layouts.test.mjs diffs the layouts page against the same sources.
 */
const html = fs.readFileSync(path.join(publicDir, "guide", "api.html"), "utf8");
const doc = new JSDOM(html).window.document;

/** Collapse the table cell's wrapped, indented text to the single line the glossary stores. */
const norm = (/** @type {string | null | undefined} */ s) => (s ?? "").replace(/\s+/g, " ").trim();

/** The health table is the one whose header carries a "Key color" column. */
const table = [...doc.querySelectorAll("table")].find((t) =>
  /key color/i.test(t.querySelector("thead")?.textContent ?? ""),
);

/** @type {Array<{ code: string, meaning: string, keyColor: string }>} */
const rows = [...(table?.querySelectorAll("tbody tr") ?? [])].map((tr) => {
  const cells = tr.querySelectorAll("td");
  return {
    code: norm(cells[0]?.textContent),
    meaning: norm(cells[1]?.textContent),
    keyColor: norm(cells[2]?.textContent),
  };
});

describe("guide health table matches the glossary (issue 021 / PRD-11)", () => {
  it("finds the health table in api.html", () => {
    expect(Boolean(table)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("lists exactly the glossary's health states", () => {
    expect(rows.map((r) => r.code).sort()).toEqual(Object.keys(HEALTH_GLOSSARY).sort());
  });

  for (const [state, term] of Object.entries(HEALTH_GLOSSARY)) {
    it(`${state} row carries the canonical meaning and key colour`, () => {
      const row = rows.find((r) => r.code === state);
      expect([state, Boolean(row)]).toEqual([state, true]);
      expect([state, row?.meaning]).toEqual([state, norm(term.meaning)]);
      expect([state, row?.keyColor]).toEqual([state, term.keyColor]);
    });
  }
});
