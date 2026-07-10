import { Router } from "express";
import type { AppContext } from "./context.js";
import { mapYouTubeError } from "../youtube/client.js";
import { toErrorBody } from "../core/errors.js";

// Category is part of the shared API contract (the dashboard/preset category picker).
export type { Category } from "@app/shared";
import type { Category } from "@app/shared";

// Category lists are effectively static, so cache per region for the process lifetime to
// avoid spending quota on every dashboard load (videoCategories.list costs 1 unit).
const cache = new Map<string, Category[]>();

/**
 * Assignable YouTube video categories for the configured region (PRD §3.2 category
 * picker). Dashboard-only; served unauthenticated like the other /api/dashboard routes.
 */
export function categoriesRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const region = ctx.regionCode;
    const cached = cache.get(region);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const resp = await ctx.yt.videoCategories.list({ part: ["snippet"], regionCode: region });
      const categories: Category[] = (resp.data.items ?? [])
        // Only assignable categories can be written to a video (PRD §6 safety).
        .filter((item) => item.snippet?.assignable)
        .map((item) => ({ id: item.id!, title: item.snippet?.title ?? item.id! }))
        .sort((a, b) => a.title.localeCompare(b.title));
      cache.set(region, categories);
      res.json(categories);
    } catch (err) {
      res.status(502).json(toErrorBody(mapYouTubeError(err)));
    }
  });

  return router;
}
