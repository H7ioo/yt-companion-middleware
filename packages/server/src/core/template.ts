import type { Preset } from "../storage/schema.js";
// VarSource/ResolvedVar are part of the shared API contract (web reads them off action results).
export type { VarSource, ResolvedVar } from "@app/shared";
import type { VarSource, ResolvedVar } from "@app/shared";

export interface ResolvedField {
  /** The rendered text (primary render, or the fallback string). */
  text: string;
  /** Every variable detected in the field, with how it resolved. */
  vars: ResolvedVar[];
  /** Names left unresolved when the field has no fallback (PRD §2, step 3). */
  missing: string[];
}

export interface ResolvedPresetText {
  title: string;
  description: string;
  /** Variables across both fields, deduped by name (first occurrence wins). */
  resolvedVars: ResolvedVar[];
  /** Missing variable names across both fields (only when a field has no fallback). */
  missing: string[];
}

interface VarRef {
  name: string;
  /** Inline default (PRD §1, `{name|default}`); null when the `{name}` has none. */
  default: string | null;
}

type Segment = { literal: string } | { ref: VarRef };

/** Replace only the `{{`/`}}` escapes with literal braces. */
function unescapeBraces(text: string): string {
  return text.replace(/\{\{/g, "{").replace(/\}\}/g, "}");
}

/**
 * Split a template into literal + variable segments. `{{`/`}}` are literal braces;
 * `{name}` / `{name|default}` are variable references. An unbalanced or empty `{...}`
 * is kept as literal text.
 */
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
        // `{}` or `{|x}` — not a real variable; keep verbatim.
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

/**
 * Resolve one field (title or description) independently (PRD §2). Every variable resolves
 * as provided value -> inline default. If any variable is unresolved and the field has
 * fallback text, the whole field becomes that text and its variables report source
 * "fallback". If any is unresolved and there is no fallback, its name is reported as missing.
 */
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
    // No variables — the field passes through unchanged (PRD §1) apart from brace escapes.
    return { text: unescapeBraces(text), vars: [], missing: [] };
  }

  if (unresolved.length > 0) {
    if (fallback != null) {
      return {
        text: unescapeBraces(fallback),
        vars: names.map((name) => ({ name, value: resolutions.get(name)!.value, source: "fallback" })),
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

/** Resolve a preset's title and description together (PRD §2), deduping reported vars. */
export function resolvePresetText(
  preset: Preset,
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
