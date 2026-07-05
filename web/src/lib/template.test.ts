import { describe, expect, it } from "vitest";
import type { Preset } from "../api.js";
import { extractVars, resolvePresetText } from "./template.js";

function preset(over: Partial<Preset>): Preset {
  return {
    id: "p1",
    title: "",
    description: "",
    privacyStatus: "public",
    category: null,
    streamBoundId: null,
    titleFallback: null,
    descriptionFallback: null,
    ...over,
  };
}

describe("extractVars", () => {
  it("returns nothing for a plain preset", () => {
    expect(extractVars(preset({ title: "Live now", description: "no vars" }))).toEqual([]);
  });

  it("detects vars across title and description, deduped, in order", () => {
    const vars = extractVars(
      preset({ title: "Lesson {lesson} — {teacher}", description: "with {teacher}" }),
    );
    expect(vars.map((v) => v.name)).toEqual(["lesson", "teacher"]);
  });

  it("captures inline defaults and marks defaulted vars as not required", () => {
    const [v] = extractVars(preset({ title: "Ep {ep|1}" }));
    expect(v).toMatchObject({ name: "ep", default: "1", required: false });
  });

  it("marks a var required when its field has no fallback and no default", () => {
    const [v] = extractVars(preset({ title: "Lesson {lesson}" }));
    expect(v.required).toBe(true);
  });

  it("marks a var not required when every field it appears in has a fallback", () => {
    const [v] = extractVars(
      preset({ title: "Lesson {lesson}", titleFallback: "Lesson" }),
    );
    expect(v.required).toBe(false);
  });

  it("stays required when it appears in one fallback-less field even if another has fallback", () => {
    const [v] = extractVars(
      preset({
        title: "{x}",
        description: "{x}",
        descriptionFallback: "desc fallback",
      }),
    );
    expect(v.required).toBe(true);
  });
});

describe("resolvePresetText (preview)", () => {
  it("substitutes provided values", () => {
    const r = resolvePresetText(preset({ title: "Lesson {lesson}" }), { lesson: "41" });
    expect(r.title).toBe("Lesson 41");
    expect(r.resolvedVars).toContainEqual({ name: "lesson", value: "41", source: "provided" });
  });

  it("uses the inline default when blank", () => {
    const r = resolvePresetText(preset({ title: "Ep {ep|1}" }), {});
    expect(r.title).toBe("Ep 1");
    expect(r.resolvedVars[0].source).toBe("default");
  });

  it("falls back to the whole-sentence fallback when a var is unresolved", () => {
    const r = resolvePresetText(
      preset({ title: "Lesson {lesson} — Anwar", titleFallback: "Anwar" }),
      {},
    );
    expect(r.title).toBe("Anwar");
    expect(r.resolvedVars[0].source).toBe("fallback");
    expect(r.missing).toEqual([]);
  });

  it("reports missing when a var is unresolved and there is no fallback", () => {
    const r = resolvePresetText(preset({ title: "Lesson {lesson}" }), {});
    expect(r.missing).toEqual(["lesson"]);
  });
});
