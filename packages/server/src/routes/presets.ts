import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { AppContext } from "./context.js";
import { presetSchema, privacyStatusSchema } from "../storage/schema.js";
import { AppError, toErrorBody } from "../core/errors.js";

const upsertBody = z.object({
  title: z.string().min(1),
  // Short button label; may be Arabic (rendered to the slug PNG). Empty = fall back to the id.
  slug: z.string().default(""),
  description: z.string().default(""),
  privacyStatus: privacyStatusSchema,
  category: z.string().min(1).nullable().default(null),
  streamBoundId: z.string().min(1).nullable().default(null),
  // Whole-sentence fallbacks for templated fields (PRD §3); optional for backward compat.
  titleFallback: z.string().nullable().default(null),
  descriptionFallback: z.string().nullable().default(null),
});

// An imported preset: the same fields plus an optional id (present in exported backups).
const importItem = upsertBody.extend({ id: z.string().min(1).optional() });
const importBody = z.object({
  presets: z.array(importItem),
  // replace: swap the whole set (restore a backup, ids preserved).
  // merge: append copies with fresh ids (clone into the existing set).
  mode: z.enum(["replace", "merge"]).default("merge"),
});

const EXPORT_VERSION = 2;

/** Preset CRUD for the dashboard (PRD §4, §8.1). */
export function presetsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(ctx.store.get().presets);
  });

  // Download all presets as a portable backup (PRD feature: bulk export).
  router.get("/export", (_req, res) => {
    res.json({
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      presets: ctx.store.get().presets,
    });
  });

  // Restore or clone presets from a backup (PRD feature: bulk import).
  router.post("/import", async (req, res) => {
    try {
      const { presets, mode } = importBody.parse(req.body);
      const seen = new Set<string>();
      const imported = presets.map(({ id, ...fields }) => {
        // merge always mints a fresh id; replace keeps the id unless it's absent/duplicated.
        const keep = mode === "replace" && id !== undefined && !seen.has(id);
        const finalId = keep ? id : nanoid(10);
        seen.add(finalId);
        return presetSchema.parse({ id: finalId, ...fields });
      });
      await ctx.store.update((s) => {
        s.presets = mode === "replace" ? imported : [...s.presets, ...imported];
      });
      res.json({ success: true, count: imported.length, presets: ctx.store.get().presets });
    } catch (err) {
      res.status(400).json(handle(err));
    }
  });

  router.post("/", async (req, res) => {
    try {
      const body = upsertBody.parse(req.body);
      const preset = presetSchema.parse({ id: nanoid(10), ...body });
      await ctx.store.update((s) => {
        s.presets.push(preset);
      });
      res.status(201).json(preset);
    } catch (err) {
      res.status(400).json(handle(err));
    }
  });

  router.put("/:id", async (req, res) => {
    try {
      const body = upsertBody.parse(req.body);
      const id = req.params.id;
      let found = false;
      await ctx.store.update((s) => {
        const idx = s.presets.findIndex((p) => p.id === id);
        if (idx === -1) return;
        found = true;
        s.presets[idx] = presetSchema.parse({ id, ...body });
      });
      if (!found) {
        res.status(404).json(toErrorBody(new AppError("INVALID_PRESET")));
        return;
      }
      res.json(ctx.store.get().presets.find((p) => p.id === id));
    } catch (err) {
      res.status(400).json(handle(err));
    }
  });

  router.delete("/:id", async (req, res) => {
    const id = req.params.id;
    const existed = ctx.store.get().presets.some((p) => p.id === id);
    if (!existed) {
      res.status(404).json(toErrorBody(new AppError("INVALID_PRESET")));
      return;
    }
    await ctx.store.update((s) => {
      s.presets = s.presets.filter((p) => p.id !== id);
      if (s.cache.activePresetId === id) s.cache.activePresetId = null;
    });
    res.json({ success: true });
  });

  return router;
}

function handle(err: unknown) {
  if (err instanceof z.ZodError) {
    return toErrorBody(new AppError("INVALID_REQUEST", err.issues[0]?.message));
  }
  return toErrorBody(err);
}
