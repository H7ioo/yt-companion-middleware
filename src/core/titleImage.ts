import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";

/**
 * Renders button text to a PNG so Companion can show scripts its bundled fonts cannot draw —
 * Arabic in particular, which renders as tofu boxes when passed as a plain text string (its
 * font set has no Arabic glyphs and no RTL shaping). @napi-rs/canvas draws through Skia +
 * HarfBuzz, so a registered Arabic font shapes and joins correctly.
 *
 * Two variants are produced from the live state (see buildDashboardState):
 *   - `slug`  — the short label (preset slug, preset id, or "Custom"), big and up to 2 lines.
 *   - `title` — the full broadcast title, smaller and up to 4 lines.
 * A Companion button binds one or the other (or toggles between them) as its image.
 */

const FONT_FAMILY = "CompanionArabic";
const SIZE = 72; // Stream Deck native button face; Companion scales as needed.
const PADDING = 6;

// Register the bundled Arabic-capable font once. Resolved relative to this module so it works
// both from src (tsx dev) and dist (compiled) — the repo's `assets/` sits two levels up from
// `core/`. Failure is non-fatal: rendering degrades to null and callers omit the PNG.
let fontReady = false;
try {
  const fontPath = fileURLToPath(
    new URL("../../assets/fonts/NotoNaskhArabic-Regular.ttf", import.meta.url),
  );
  fontReady = !!GlobalFonts.registerFromPath(fontPath, FONT_FAMILY);
  if (!fontReady) console.warn("[titleImage] Arabic font failed to register; PNGs disabled");
} catch (err) {
  console.warn(`[titleImage] canvas/font init failed; PNGs disabled: ${(err as Error).message}`);
}

interface Variant {
  maxLines: number;
  maxFont: number;
  minFont: number;
}
const VARIANTS: Record<"slug" | "title", Variant> = {
  slug: { maxLines: 2, maxFont: 30, minFont: 12 },
  title: { maxLines: 4, maxFont: 22, minFont: 9 },
};

// Memoize by text so a PNG is drawn only when its text actually changes — the title moves
// rarely while Companion polls/streams constantly. Bounded, oldest-evicted, so an operator
// churning through presets can't grow it without limit.
const CACHE_MAX = 64;
const cache = new Map<string, string | null>();

/**
 * Returns a base64 PNG (no data-URI prefix, ready for Companion's base64 image input) of
 * `text` drawn in the given variant, or null when the text is empty or rendering is
 * unavailable. Memoized on `kind:text`.
 */
export function renderTextPng(text: string, kind: "slug" | "title"): string | null {
  const trimmed = text.trim();
  if (!trimmed || !fontReady) return null;
  const key = `${kind}:${trimmed}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const png = draw(trimmed, VARIANTS[kind]);
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, png);
  return png;
}

function draw(text: string, v: Variant): string | null {
  try {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext("2d");
    const inner = SIZE - PADDING * 2;

    // Largest font size at which the text wraps within maxLines and every line fits the width.
    let fontSize = v.maxFont;
    let lines: string[] = [];
    for (; fontSize >= v.minFont; fontSize--) {
      ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
      lines = wrap(ctx, text, inner);
      if (lines.length <= v.maxLines && lines.every((l) => ctx.measureText(l).width <= inner)) {
        break;
      }
    }
    // At the floor size, hard-cap the line count and ellipsize the overflow.
    if (lines.length > v.maxLines) {
      lines = lines.slice(0, v.maxLines);
      lines[v.maxLines - 1] = ellipsize(ctx, lines[v.maxLines - 1], inner);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.direction = "rtl"; // correct bidi ordering for Arabic; harmless for LTR text.

    const lineHeight = fontSize * 1.15;
    const blockHeight = lineHeight * lines.length;
    let y = SIZE / 2 - blockHeight / 2 + lineHeight / 2;
    // White text with a thin dark outline so it stays legible over any Companion button colour.
    ctx.lineWidth = Math.max(2, fontSize / 10);
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.fillStyle = "#ffffff";
    for (const line of lines) {
      ctx.strokeText(line, SIZE / 2, y);
      ctx.fillText(line, SIZE / 2, y);
      y += lineHeight;
    }
    return canvas.toBuffer("image/png").toString("base64");
  } catch (err) {
    console.warn(`[titleImage] render failed: ${(err as Error).message}`);
    return null;
  }
}

/** Greedy word wrap; a single word wider than the box is broken per-character. */
function wrap(ctx: import("@napi-rs/canvas").SKRSContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  const pushBrokenWord = (word: string) => {
    let chunk = "";
    for (const ch of word) {
      if (chunk && ctx.measureText(chunk + ch).width > max) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    line = chunk;
  };
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= max) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      if (ctx.measureText(word).width > max) pushBrokenWord(word);
      else line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Trims a line to fit `max`, appending an ellipsis. */
function ellipsize(ctx: import("@napi-rs/canvas").SKRSContext2D, line: string, max: number): string {
  const ell = "…";
  if (ctx.measureText(line).width <= max) return line;
  let s = line;
  while (s && ctx.measureText(s + ell).width > max) s = s.slice(0, -1);
  return s + ell;
}
