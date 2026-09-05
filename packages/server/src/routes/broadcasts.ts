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
import { retireOne, sweepBroadcasts, type SweepResult } from "../youtube/retire.js";
import { deleteConfirmation } from "@app/shared";
import { isEligibilityError, noteDriving, noteRidingMode } from "../youtube/eligibility.js";
import { resolvePresetText } from "../core/template.js";
import { privacyStatusSchema, type PreparedBroadcast } from "../storage/schema.js";

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

    // Clear our own ghosts *before* the insert, not after it. YouTube refuses `insert` once the
    // channel holds too many live and scheduled broadcasts, and the whole point of retiring them
    // is that the refusal never happens on the night it matters (issue 064). One read, plus a
    // write per ghost actually found — charged to this press, because the quota tracker counts
    // those calls and a reported cost that leaves them out disagrees with it.
    const sweepUnits = await sweepQuietly(ctx);

    try {
      const { broadcast: prepared, warning } = await prepareBroadcast(ctx.yt, input, {
        now: new Date().toISOString(),
        // Persisted between the insert and the bind, on purpose: from the moment the broadcast
        // exists it is ours to clean up (issue 064), and a bind that fails afterwards must not
        // leave a broadcast on the channel that nothing may ever delete. Upserted by id, because
        // the same record is written again — with the key it is actually bound to — once the
        // bind lands.
        onRecord: async (record) => {
          await ctx.store.update((s) => {
            const rest = s.preparedBroadcasts.filter((p) => p.id !== record.id);
            s.preparedBroadcasts = [...rest, record];
          });
        },
      });
      // The only proof the channel may create broadcasts is having just created one — which is
      // also what clears a riding-mode finding from before the channel crossed the threshold.
      await noteDriving(ctx.store, prepared.createdAt);
      ctx.logger.push({
        level: warning ? "warn" : "info",
        category: "action",
        code: null,
        message: warning
          ? `Prepared “${prepared.title}” — ${prepared.watchUrl} — ${warning}`
          : `Prepared “${prepared.title}” — ${prepared.watchUrl}`,
      });
      // A prepared broadcast is usually the next thing to air, so the rail should not wait up to
      // 60s to say so.
      void ctx.cache.refresh({ force: true });
      // 200 even for a half-finished preparation: the broadcast is on the channel with a public
      // link, and an error body would hide the id the operator needs to fix or delete it — and
      // would have them press create again, putting a second public broadcast out there.
      res.json({ prepared, quotaUnits: prepareCost(input) + sweepUnits, warning });
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
      // A full channel is not a server fault either — it is a state the operator can fix, and the
      // message already says how. 502 would file it with the outages nobody can act on.
      if (mapped.code === "BROADCAST_LIMIT_REACHED") {
        res.status(409).json(toErrorBody(mapped));
        return;
      }
      res.status(502).json(toErrorBody(mapped));
    }
  });

  /**
   * Retire the broadcasts this app created and nobody used (PRD-16 §5, issue 064).
   *
   * The same sweep the prepare route runs, on the operator's press — for the moment they meet a
   * full channel and want it cleared now rather than on the next preparation.
   */
  router.post("/retire", async (_req, res) => {
    if (!ctx.store.get().service.apiEnabled) {
      res.status(409).json(toErrorBody(new AppError("SERVICE_DISABLED")));
      return;
    }
    try {
      res.json(await runSweep(ctx));
    } catch (err) {
      res.status(502).json(toErrorBody(mapYouTubeError(err)));
    }
  });

  /**
   * Delete one broadcast this app created, deliberately (PRD-16 §5, issue 064).
   *
   * Two guards, and they are the feature:
   *
   *   - **The id must be in the ownership record.** Nothing else is ever deletable through this
   *     app. A broadcast a human made in Studio looks identical on the API, so the record is the
   *     only thing that can tell them apart — and being unable to delete someone else's show is
   *     worth more than being able to delete ours from one more place.
   *   - **`confirm` must be sent.** The dashboard asks the question in a dialog; this is the same
   *     question for a stale tab or a direct call, and the refusal carries the text so they ask
   *     it the same way. The sibling of the stream-binding confirmation in issue 051.
   */
  router.delete("/prepared/:id", async (req, res) => {
    if (!ctx.store.get().service.apiEnabled) {
      res.status(409).json(toErrorBody(new AppError("SERVICE_DISABLED")));
      return;
    }
    const id = req.params.id;
    const record = ctx.store.get().preparedBroadcasts.find((p) => p.id === id);
    if (!record) {
      res.status(404).json(
        toErrorBody(
          new AppError(
            "NO_TARGET_FOUND",
            `Broadcast ${id} is not one this app created, so it is not this app's to delete. ` +
              `Delete it in YouTube Studio if that is really what you want.`,
          ),
        ),
      );
      return;
    }
    // Aired broadcasts are recordings, and deleting one takes the recording with it. The dialog
    // already hides the button; this is the same refusal for a stale tab or a direct call, and it
    // is the sweep's rule (`planSweep` never touches an aired record) held at the route too.
    if (record.airedAt !== null) {
      res.status(409).json(
        toErrorBody(
          new AppError(
            "INVALID_REQUEST",
            `“${record.title}” has been on air, so it is a recording now. ` +
              `Delete it in YouTube Studio if that is really what you want.`,
          ),
        ),
      );
      return;
    }
    if (record.retiredAt !== null) {
      res.status(409).json(
        toErrorBody(
          new AppError("INVALID_REQUEST", `“${record.title}” has already been removed from YouTube.`),
        ),
      );
      return;
    }

    const confirmation = deleteConfirmation(record);
    if ((req.body as { confirm?: unknown } | undefined)?.confirm !== true) {
      res
        .status(409)
        .json({ ...toErrorBody(new AppError("CONFIRMATION_REQUIRED", confirmation.warning)), confirmation });
      return;
    }

    try {
      const reason = "Deleted by hand from the dashboard.";
      const retired = await retireOne(ctx.yt, record, { now: Date.now(), reason });
      await upsertPrepared(ctx, retired);
      ctx.logger.push({
        level: "info",
        category: "action",
        code: null,
        message: `Deleted “${retired.title}” from YouTube — ${reason} Its link no longer works.`,
      });
      void ctx.cache.refresh({ force: true });
      res.json({ retired, quotaUnits: QUOTA_COST.write });
    } catch (err) {
      res.status(502).json(toErrorBody(mapYouTubeError(err)));
    }
  });

  return router;
}

/** Upserts one ownership record by id, leaving the rest of the list alone. */
async function upsertPrepared(ctx: AppContext, record: PreparedBroadcast): Promise<void> {
  await ctx.store.update((s) => {
    s.preparedBroadcasts = [...s.preparedBroadcasts.filter((p) => p.id !== record.id), record];
  });
}

/**
 * The sweep, with its results written to the store and said out loud in the activity feed —
 * "recorded where the operator can see what was removed and why".
 */
async function runSweep(ctx: AppContext): Promise<SweepResult> {
  const result = await sweepBroadcasts(ctx.yt, ctx.store.get().preparedBroadcasts, {
    now: Date.now(),
    onUpdate: (record) => upsertPrepared(ctx, record),
  });
  for (const r of result.retired) {
    ctx.logger.push({
      level: "info",
      category: "action",
      code: null,
      message: `Retired “${r.title}” — ${r.retiredReason}`,
    });
  }
  for (const g of result.gone) {
    ctx.logger.push({
      level: "info",
      category: "action",
      code: null,
      message: `“${g.title}” is no longer on YouTube — ${g.retiredReason}`,
    });
  }
  for (const f of result.failed) {
    ctx.logger.push({
      level: "warn",
      category: "action",
      code: null,
      message: `Could not retire “${f.title}” — ${f.message}`,
    });
  }
  return result;
}

/**
 * The sweep as a courtesy before a preparation: it must never be the reason tonight's broadcast
 * does not get made. A cleanup that cannot run is a note in the feed, not a failed press.
 */
async function sweepQuietly(ctx: AppContext): Promise<number> {
  try {
    return (await runSweep(ctx)).quotaUnits;
  } catch (err) {
    ctx.logger.push({
      level: "warn",
      category: "action",
      code: null,
      message: `Could not clear old broadcasts before creating this one — ${mapYouTubeError(err).message}`,
    });
    // The read that failed still cost its unit in most refusals, but the tracker is the authority
    // on what was actually spent; a sweep that got nowhere adds nothing to this press's total.
    return 0;
  }
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

  // `category: null` in the body is an explicit "leave YouTube's own default alone" and is
  // honoured as given — collapsing it into the app default would make "no category" impossible
  // to ask for, and would spend a read and a write nobody asked to spend.
  const categoryId =
    body.category !== undefined
      ? body.category
      : (preset?.category ?? state.defaults.defaultCategory ?? null);

  return {
    title,
    description,
    // Public is the fallback, because that is what this channel's broadcasts are for (issue 074).
    // A safe-looking `unlisted` default is the one that fails quietly: nobody notices a service
    // went out unlisted until it is over. A preset's own privacy still wins — it is a recorded
    // decision, and a default only applies where none was recorded.
    privacyStatus: body.privacyStatus ?? preset?.privacyStatus ?? "public",
    scheduledStartTime: scheduled.toISOString(),
    streamId,
    categoryId,
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
