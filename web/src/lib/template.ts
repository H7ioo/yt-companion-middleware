import type { Preset } from "../api.js";

/**
 * Client-side mirror of the server template engine (src/core/template.ts) so the fill
 * popup can render a live preview and detect variables without a round-trip. Kept in sync
 * with the server: same parse rules, same per-field resolution order (PRD §1–2).
 */

export type VarSource = "provided" | "default" | "fallback";

export interface ResolvedVar {
  name: string;
  value: string | null;
  source: VarSource;
}

export interface ResolvedField {
  text: string;
  vars: ResolvedVar[];
  missing: string[];
}

export interface ResolvedPresetText {
  title: string;
  description: string;
  resolvedVars: ResolvedVar[];
  missing: string[];
}

/** A variable detected in a preset, with everything the fill popup needs to render it. */
export interface VarField {
  name: string;
  /** Inline default (`{name|default}`), or null when the variable has none. */
  default: string | null;
  /**
   * True when leaving this blank rejects the action: it has no inline default and appears
   * in at least one field that has no fallback text (would raise MISSING_TEMPLATE_VARS).
   */
  required: boolean;
}

export interface VarRef {
  name: string;
  default: string | null;
}

type Segment = { literal: string } | { ref: VarRef };

function unescapeBraces(text: string): string {
  return text.replace(/\{\{/g, "{").replace(/\}\}/g, "}");
}

function parse(text: string): Segment[] {
  const segments: Segment[] = [];
  let literal = "";
  const flush = () => {
    if (literal) {
      segments.push({ literal });
      literal = "";
    }
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "{" && text[i + 1] === "{") {
      literal += "{";
      i += 2;
    } else if (c === "}" && text[i + 1] === "}") {
      literal += "}";
      i += 2;
    } else if (c === "{") {
      const end = text.indexOf("}", i + 1);
      if (end === -1) {
        literal += c;
        i += 1;
        continue;
      }
      const inner = text.slice(i + 1, end);
      const pipe = inner.indexOf("|");
      const name = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
      if (name === "") {
        literal += text.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      flush();
      segments.push({ ref: { name, default: pipe === -1 ? null : inner.slice(pipe + 1) } });
      i = end + 1;
    } else {
      literal += c;
      i += 1;
    }
  }
  flush();
  return segments;
}

function isRef(s: Segment): s is { ref: VarRef } {
  return "ref" in s;
}

export function resolveField(
  text: string,
  fallback: string | null | undefined,
  vars: Record<string, string>,
): ResolvedField {
  const segments = parse(text);
  const refs = segments.filter(isRef).map((s) => s.ref);
  const names = [...new Set(refs.map((r) => r.name))];

  const resolutions = new Map<string, { value: string | null; source: VarSource | null }>();
  for (const name of names) {
    const supplied = vars[name];
    if (supplied !== undefined && supplied.trim() !== "") {
      resolutions.set(name, { value: supplied, source: "provided" });
      continue;
    }
    const withDefault = refs.find((r) => r.name === name && r.default !== null);
    if (withDefault) {
      resolutions.set(name, { value: withDefault.default, source: "default" });
    } else {
      resolutions.set(name, { value: null, source: null });
    }
  }

  const unresolved = names.filter((n) => resolutions.get(n)!.source === null);

  if (names.length === 0) {
    return { text: unescapeBraces(text), vars: [], missing: [] };
  }

  if (unresolved.length > 0) {
    if (fallback != null) {
      return {
        text: unescapeBraces(fallback),
        vars: names.map((name) => ({
          name,
          value: resolutions.get(name)!.value,
          source: "fallback",
        })),
        missing: [],
      };
    }
    return { text: "", vars: [], missing: unresolved };
  }

  const rendered = segments
    .map((s) => (isRef(s) ? resolutions.get(s.ref.name)!.value! : s.literal))
    .join("");
  return {
    text: rendered,
    vars: names.map((name) => {
      const r = resolutions.get(name)!;
      return { name, value: r.value, source: r.source! };
    }),
    missing: [],
  };
}

export function resolvePresetText(
  preset: Pick<Preset, "title" | "description" | "titleFallback" | "descriptionFallback">,
  vars: Record<string, string> = {},
): ResolvedPresetText {
  const title = resolveField(preset.title, preset.titleFallback, vars);
  const description = resolveField(preset.description, preset.descriptionFallback, vars);

  const seen = new Set<string>();
  const resolvedVars: ResolvedVar[] = [];
  for (const v of [...title.vars, ...description.vars]) {
    if (seen.has(v.name)) continue;
    seen.add(v.name);
    resolvedVars.push(v);
  }

  return {
    title: title.text,
    description: description.text,
    resolvedVars,
    missing: [...new Set([...title.missing, ...description.missing])],
  };
}

/** Refs (name + inline default) detected in one raw field, in order of appearance. */
function fieldRefs(text: string): VarRef[] {
  return parse(text)
    .filter(isRef)
    .map((s) => s.ref);
}

/**
 * Public: variables detected in a single raw field, deduped by name (first occurrence keeps
 * the inline default), in order of appearance. Used by the preset form to give live "this is
 * now a variable" feedback under the title/description inputs as the operator types.
 */
export function detectVars(text: string): VarRef[] {
  const seen = new Set<string>();
  const out: VarRef[] = [];
  for (const ref of fieldRefs(text)) {
    if (seen.has(ref.name)) continue;
    seen.add(ref.name);
    out.push(ref);
  }
  return out;
}

/**
 * Detect every template variable in a preset's title and description, deduped by name
 * (first occurrence wins for the inline default), in the order they appear. Returns an
 * empty list for a plain preset — the caller uses that to fire immediately (PRD §5).
 */
export function extractVars(
  preset: Pick<Preset, "title" | "description" | "titleFallback" | "descriptionFallback">,
): VarField[] {
  const fields = [
    { refs: fieldRefs(preset.title), hasFallback: preset.titleFallback != null },
    { refs: fieldRefs(preset.description), hasFallback: preset.descriptionFallback != null },
  ];

  const byName = new Map<string, VarField>();
  for (const field of fields) {
    for (const ref of field.refs) {
      const existing = byName.get(ref.name);
      // A blank input rejects only when the variable has no inline default and lands in a
      // field without fallback text.
      const requiredHere = ref.default === null && !field.hasFallback;
      if (!existing) {
        byName.set(ref.name, {
          name: ref.name,
          default: ref.default,
          required: requiredHere,
        });
      } else {
        if (existing.default === null && ref.default !== null) existing.default = ref.default;
        existing.required = existing.required || requiredHere;
      }
    }
  }

  // A variable with any inline default is never required — the default fills a blank.
  for (const v of byName.values()) {
    if (v.default !== null) v.required = false;
  }

  return [...byName.values()];
}
