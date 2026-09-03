import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { AppError, toErrorBody } from "../core/errors.js";
import { QUOTA_COST } from "../core/quota.js";
import { mapYouTubeError } from "../youtube/client.js";
import { listBroadcasts } from "../youtube/broadcasts.js";
import { listWhatWillAir } from "../youtube/willAir.js";
import { listStreams } from "./streams.js";
import { prepareBroadcast, type PrepareInput } from "../youtube/prepare.js";
import { isEligibilityError, noteDriving, noteRidingMode } from "../youtube/eligibility.js";
import { resolvePresetText } from "../core/template.js";
import { privacyStatusSchema } from "../storage/schema.js";

// BroadcastListing is part of the shared API contract (the dashboard's broadcast list).
export type { BroadcastListing } from "@app/shared";

/**
 * "Which broadcast will actually air?" — the read-only answer that ends a Studio trip (PRD-16 §1,
 * issue 057).
 *
 * Read-only and on demand: nothing here polls. A list refreshed on an interval costs more quota
 * than the single target the background loop already tracks, so the operator asks for it.
 */
export function broadcastsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    // The API master switch means "this install spends no quota", and three live reads on a
    // paused install would break that promise. The dashboard already hides the panel while
    // paused; this is the half that holds for a stale tab or a direct call.
    if (!ctx.store.get().service.apiEnabled) {
      res.status(409).json(toErrorBody(new AppError("SERVICE_DISABLED")));
      return;
    }
    // Counted from this request's own calls rather than from a delta of the process-wide quota
    // counter: the background poll runs concurrently, so a delta charges its calls to this
    // listing (and reads negative across the Pacific-midnight reset). Typically 3 — one page of
    // active, one page of upcoming, one stream read — rising by one per extra page.
    let calls = 0;
    const count = () => {
      calls += 1;
    };
    try {
      const [active, upcoming, streams] = await Promise.all([
        listBroadcasts(ctx.yt, { broadcastStatus: "active" }, count),
        // The same page walk resolution does, deliberately: a list that reads fewer broadcasts
        // than resolution does can omit the very broadcast about to air — which is the bug this
        // whole feature exists to make visible.
        listBroadcasts(ctx.yt, { broadcastStatus: "upcoming" }, count),
        // Walked too: a truncated key list would print a wrong key count as fact in the verdict
        // and leave the keys past page 1 named by raw id.
        listStreams(ctx.yt, count),
      ]);

      const listing = listWhatWillAir({
        active,
        upcoming,
        streams,
        defaultStreamBoundId: ctx.store.get().defaults.defaultStreamBoundId,
      });
      res.json({ ...listing, quotaUnits: calls * QUOTA_COST.read });
    } catch (err) {
      res.status(502).json(toErrorBody(mapYouTubeError(err)));
    }
  });

  /**
   * What this app created, newest first (issue 062).
   *
   * Served from the store, not from YouTube: it is an ownership record, and the one question it
   * answers — "did we make this one?" — has no answer on the API resource. Free, so the panel can
   * show the share link on load without the operator deciding whether it is worth a read.
   */
  router.get("/prepared", (_req, res) => {
    const prepared = [...ctx.store.get().preparedBroadcasts].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    res.json(prepared);
  });

  /**
   * Prepare tonight's broadcast ahead of time (PRD-16 §2, issue 062).
   *
   * Deliberately its own route and never a side effect of applying a preset: applying a preset
   * writes metadata onto a broadcast that already exists, and creating a public broadcast is a
   * different kind of act — one that puts a link into the world. It is a press, always.
   *
   * Everything that can be refused is refused before the insert: a missing template variable, a
   * scheduled start that is not a timestamp, no existing key to bind. Cleaning up a broadcast
   * created by a request that was going to fail anyway costs a write and a confirmation nobody
   * asked for.
   */
  router.post("/prepare", async (req, res) => {
    if (!ctx.store.get().service.apiEnabled) {
      res.status(409).json(toErrorBody(new AppError("SERVICE_DISABLED")));
      return;
    }

    let input: PrepareInput;
    try {
      input = resolvePrepareInput(ctx, prepareBody.parse(req.body));
    } catch (err) {
      res.status(400).json(toErrorBody(asAppError(err)));
      return;
    }

    try {
      const prepared = await prepareBroadcast(ctx.yt, input, {
        now: new Date().toISOString(),
        // Persisted between the insert and the bind, on purpose: from the moment the broadcast
        // exists it is ours to clean up (issue 064), and a bind that fails afterwards must not
        // leave a broadcast on the channel that nothing may ever delete.
        onCreated: async (record) => {
          await ctx.store.update((s) => {
            s.preparedBroadcasts = [...s.preparedBroadcasts, record];
          });
        },
      });
      // The only proof the channel may create broadcasts is having just created one — which is
      // also what clears a riding-mode finding from before the channel crossed the threshold.
      await noteDriving(ctx.store, prepared.createdAt);
      ctx.logger.push({
        level: "info",
        category: "action",
        code: null,
        message: `Prepared “${prepared.title}” — ${prepared.watchUrl}`,
      });
      // A prepared broadcast is usually the next thing to air, so the rail should not wait up to
      // 60s to say so.
      void ctx.cache.refresh({ force: true });
      res.json({ prepared, quotaUnits: prepareCost(input) });
    } catch (err) {
      const mapped = mapYouTubeError(err);
      if (isEligibilityError(mapped)) {
        // Riding mode: YouTube refused the channel, not the app (issue 061). Recorded here as
        // well as in the poll loop, because this is the one call that asks the question directly.
        if (mapped.reason) {
          await noteRidingMode(ctx.store, {
            reason: mapped.reason,
            message: mapped.message,
            now: new Date().toISOString(),
          });
        }
        res.status(409).json(toErrorBody(mapped));
        return;
      }
      res.status(502).json(toErrorBody(mapped));
    }
  });

  return router;
}

const prepareBody = z.object({
  /** Prepare from a preset, or null/absent for the ad-hoc fields below. */
  presetId: z.string().min(1).nullable().default(null),
  /** Values for the preset's `{name}` template variables, exactly as the apply path takes them. */
  vars: z.record(z.string()).default({}),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  privacyStatus: privacyStatusSchema.optional(),
  /** Override; absent means the preset's, then the app default, then none. */
  category: z.string().min(1).nullable().optional(),
  /** An existing key to bind. Absent means the preset's, then the app default. */
  streamId: z.string().min(1).optional(),
  /** ISO-8601. YouTube requires one on every inserted broadcast, so this app does too. */
  scheduledStartTime: z.string().min(1),
});

/**
 * Turns the request into the fully-resolved insert, or throws the AppError that says why it
 * cannot be one. Preset text is resolved here rather than inside the YouTube call so a missing
 * variable costs nothing.
 */
function resolvePrepareInput(
  ctx: AppContext,
  body: z.infer<typeof prepareBody>,
): PrepareInput {
  const scheduled = new Date(body.scheduledStartTime);
  if (Number.isNaN(scheduled.getTime())) {
    throw new AppError(
      "INVALID_REQUEST",
      `“${body.scheduledStartTime}” is not a date and time YouTube can schedule against.`,
    );
  }

  const state = ctx.store.get();
  const preset = body.presetId
    ? state.presets.find((p) => p.id === body.presetId)
    : null;
  if (body.presetId && !preset) {
    throw new AppError("INVALID_PRESET", `Preset '${body.presetId}' not found`);
  }

  let title = body.title;
  let description = body.description ?? "";
  if (preset) {
    const resolved = resolvePresetText(preset, body.vars);
    if (resolved.missing.length > 0) {
      throw new AppError(
        "MISSING_TEMPLATE_VARS",
        `Unresolved template variables: ${resolved.missing.join(", ")}`,
      );
    }
    title = body.title ?? resolved.title;
    description = body.description ?? resolved.description;
  }
  if (!title) {
    throw new AppError("INVALID_REQUEST", "A broadcast needs a title before it is created.");
  }

  const streamId = body.streamId ?? preset?.streamBoundId ?? state.defaults.defaultStreamBoundId;
  if (!streamId) {
    // Never resolved by creating one: a new key would have to be pasted into OBS before the show,
    // which is the errand this whole feature exists to remove.
    throw new AppError(
      "INVALID_REQUEST",
      "No ingestion key to bind — set one on the preset or as the app default. " +
        "Preparing never creates a key, because OBS already holds one.",
    );
  }

  const category =
    body.category !== undefined
      ? body.category
      : (preset?.category ?? null);

  return {
    title,
    description,
    privacyStatus: body.privacyStatus ?? preset?.privacyStatus ?? "unlisted",
    scheduledStartTime: scheduled.toISOString(),
    streamId,
    categoryId: category ?? state.defaults.defaultCategory,
    presetId: preset?.id ?? null,
  };
}

/** Insert + bind, plus the category write when there is one. Stated so the UI can warn. */
function prepareCost(input: PrepareInput): number {
  return QUOTA_COST.write * (input.categoryId === null ? 2 : 3) + (input.categoryId === null ? 0 : QUOTA_COST.read);
}

function asAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof z.ZodError) {
    return new AppError("INVALID_REQUEST", err.issues[0]?.message);
  }
  return new AppError("INVALID_REQUEST");
}
