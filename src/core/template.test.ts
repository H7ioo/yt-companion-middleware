import { describe, expect, it } from "vitest";
import { resolvePresetText } from "./template.js";
import type { Preset } from "../storage/schema.js";

function preset(over: Partial<Preset> = {}): Preset {
  return {
    id: "p1",
    title: "Static title",
    description: "Static description",
    privacyStatus: "public",
    category: null,
    streamBoundId: null,
    titleFallback: null,
    descriptionFallback: null,
    ...over,
  };
}

describe("resolvePresetText (PRD §1-2)", () => {
  it("passes a variable-less preset through unchanged with no resolvedVars", () => {
    const r = resolvePresetText(preset({ title: "Gaming", description: "Come watch" }), {});
    expect(r.title).toBe("Gaming");
    expect(r.description).toBe("Come watch");
    expect(r.resolvedVars).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it("substitutes a provided value and reports source 'provided'", () => {
    const r = resolvePresetText(preset({ title: "Lesson {lesson}" }), { lesson: "41" });
    expect(r.title).toBe("Lesson 41");
    expect(r.resolvedVars).toContainEqual({ name: "lesson", value: "41", source: "provided" });
  });

  it("uses an inline default when the value is not supplied, source 'default'", () => {
    const r = resolvePresetText(preset({ title: "Ep {n|1}" }), {});
    expect(r.title).toBe("Ep 1");
    expect(r.resolvedVars).toContainEqual({ name: "n", value: "1", source: "default" });
  });

  it("a supplied value overrides the inline default", () => {
    const r = resolvePresetText(preset({ title: "Ep {n|1}" }), { n: "9" });
    expect(r.title).toBe("Ep 9");
    expect(r.resolvedVars).toContainEqual({ name: "n", value: "9", source: "provided" });
  });

  it("treats {{ and }} as literal braces, not variables", () => {
    const r = resolvePresetText(preset({ title: "Set {{name}} now" }), {});
    expect(r.title).toBe("Set {name} now");
    expect(r.resolvedVars).toEqual([]);
  });

  it("renders the whole-sentence fallback when a variable is unresolved", () => {
    const r = resolvePresetText(
      preset({ title: "Drs {lesson} - AW", titleFallback: "Anwar - AW" }),
      {},
    );
    expect(r.title).toBe("Anwar - AW");
    expect(r.resolvedVars).toContainEqual({ name: "lesson", value: null, source: "fallback" });
    expect(r.missing).toEqual([]);
  });

  it("reports MISSING when a variable is unresolved and there is no fallback", () => {
    const r = resolvePresetText(preset({ title: "Lesson {lesson}", titleFallback: null }), {});
    expect(r.missing).toContain("lesson");
  });

  it("resolves title and description independently", () => {
    const r = resolvePresetText(
      preset({
        title: "Drs {lesson}",
        titleFallback: "Anwar",
        description: "Host {host|Ali}",
      }),
      {},
    );
    // Title falls back (missing lesson); description still renders via its inline default.
    expect(r.title).toBe("Anwar");
    expect(r.description).toBe("Host Ali");
    expect(r.resolvedVars).toContainEqual({ name: "lesson", value: null, source: "fallback" });
    expect(r.resolvedVars).toContainEqual({ name: "host", value: "Ali", source: "default" });
    expect(r.missing).toEqual([]);
  });
});
