import { Router } from "express";
import type { AppContext } from "./context.js";
import { resolveDisplayLabel } from "../core/snapshot.js";
import { renderTextPng } from "../core/titleImage.js";

/**
 * Feedback endpoints (PRD §5.4). Served entirely from the in-app cache — never a live
 * YouTube call — so Companion polling every 5s costs zero YouTube quota.
 */
export function feedbackRouter(ctx: AppContext): Router {
  const router = Router();

  // A superset endpoint: the active preset plus the core status/health/busy signals, so a
  // Companion button can bind text, on-air colour, health lamp and the active-preset
  // highlight from a single poll instead of hitting /status, /busy and /health separately.
  // The narrow endpoints below stay for buttons that only need one field.
  router.get("/active-preset", (_req, res) => {
    const c = ctx.cache.snapshot();
    const q = ctx.quota.snapshot();
    // The saved preset that was last applied, so Companion can label/inspect the active key
    // without a second call to /api/dashboard/presets. null when none is active or the preset
    // has since been deleted. `title` below stays the live broadcast title, not the preset's.
    const activePreset =
      c.activePresetId != null
        ? (ctx.store.get().presets.find((p) => p.id === c.activePresetId) ?? null)
        : null;
    // Latin-safe button label and the two Arabic-capable PNGs (base64) so a single poll can
    // drive a button that shows the slug text, the slug image, or the full-title image.
    const displayLabel = resolveDisplayLabel(ctx.store, c.activePresetId);
    res.json({
      activePresetId: c.activePresetId,
      activePreset,
      title: c.status.title,
      displayLabel,
      slugPng: renderTextPng(displayLabel, "slug"),
      titlePng: c.status.title ? renderTextPng(c.status.title, "title") : null,
      privacyStatus: c.status.privacyStatus,
      isLive: c.status.isLive,
      noTarget: c.status.noTarget,
      busy: ctx.runner.isBusy(),
      health: c.health,
      apiEnabled: ctx.store.get().service.apiEnabled,
      quotaRemaining: q.remaining,
    });
  });

  // Raw PNG image endpoints for buttons that pull an image by URL rather than reading base64
  // out of the JSON/WebSocket state. `slug.png` always draws (label falls back to "Custom");
  // `title.png` 404s when there is no live title to draw.
  router.get("/slug.png", (_req, res) => {
    const c = ctx.cache.snapshot();
    const png = renderTextPng(resolveDisplayLabel(ctx.store, c.activePresetId), "slug");
    sendPng(res, png);
  });

  router.get("/title.png", (_req, res) => {
    const { title } = ctx.cache.snapshot().status;
    sendPng(res, title ? renderTextPng(title, "title") : null);
  });

  router.get("/status", (_req, res) => {
    const { status } = ctx.cache.snapshot();
    res.json({
      title: status.title,
      privacyStatus: status.privacyStatus,
      isLive: status.isLive,
    });
  });

  router.get("/busy", (_req, res) => {
    res.json({ busy: ctx.runner.isBusy() });
  });

  // Note: GET /api/feedback/health is registered directly in server.ts (before this router mounts,
  // so it also answers in setup mode). A duplicate here would be shadowed — hence intentionally
  // absent. See server.ts.

  return router;
}

/** Writes a base64 PNG as an image response, or 404 when there is nothing to draw. */
function sendPng(res: import("express").Response, base64: string | null): void {
  if (!base64) {
    res.status(404).json({ success: false, error: { code: "NO_IMAGE", message: "No image" } });
    return;
  }
  const buf = Buffer.from(base64, "base64");
  res.setHeader("Content-Type", "image/png");
  // Short cache: the image only changes when the title/label does, but Companion may poll.
  res.setHeader("Cache-Control", "no-cache");
  res.send(buf);
}
