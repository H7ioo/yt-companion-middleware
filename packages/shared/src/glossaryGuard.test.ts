import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A grep guard for the one phrase that must never come back (issue 066).
 *
 * "Persistent container" named a default broadcast YouTube stopped auto-creating on 2020-09-01
 * and deleted. Copy that uses it is not merely dated — it tells the operator their edits land on
 * a permanent resource, so they never check which broadcast is actually next, which is the exact
 * mistake that puts the wrong title on air.
 *
 * The phrase survives in two legitimate places, and both are deliberately out of scope: the
 * `broadcastType: "persistent"` API parameter (YouTube's word, in server code and dev scripts,
 * kept for the pre-2020 channels that still have one) and the Companion module's "persistent
 * WebSocket". So the guard matches the noun phrase, not the word, and scans only the surfaces an
 * operator reads.
 *
 * A comment that has to quote the phrase to explain why it went away marks its line `[retired]`.
 * That exemption is per-line and visible in the diff, so quoting it is a deliberate act rather
 * than something a reviewer has to notice.
 *
 * The scan runs over the whole file rather than line by line: the phrase reads the same to an
 * operator whether or not a formatter wrapped it across two lines, so `\s+` in the pattern has to
 * be allowed to cross a newline.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Every surface whose words reach an operator: dashboard, guide, glossary, Companion. */
const USER_FACING = [
  "packages/web/src",
  "packages/shared/src",
  "packages/shared/GLOSSARY.md",
  "packages/server/public/guide",
  "packages/server/src/core/errors.ts",
  "companion-module/main.js",
  "companion-module/src",
  "companion-module/companion/HELP.md",
];

const BANNED = /persistent\s+(broadcast\s+)?container/gi;

function filesUnder(target: string): string[] {
  const abs = path.join(repoRoot, target);
  if (!statSync(abs).isDirectory()) return [abs];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.name === "node_modules" || e.name === "dist"
      ? []
      : filesUnder(path.join(target, e.name)),
  );
}

describe("retired vocabulary", () => {
  it("says 'persistent container' on no surface an operator reads", () => {
    const offenders = USER_FACING.flatMap(filesUnder)
      .filter((f) => !f.endsWith("glossaryGuard.test.ts"))
      .flatMap((f) => {
        const text = readFileSync(f, "utf8");
        const lines = text.split("\n");
        return [...text.matchAll(BANNED)].flatMap((m) => {
          const first = text.slice(0, m.index).split("\n").length - 1;
          const last = first + m[0].split("\n").length - 1;
          const exempt = lines
            .slice(first, last + 1)
            .some((line) => line.includes("[retired]"));
          return exempt ? [] : [`${path.relative(repoRoot, f)}:${first + 1}`];
        });
      });
    expect(offenders).toEqual([]);
  });
});
