import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { AppError, toErrorBody } from "../core/errors.js";
import { notifySchema } from "../storage/schema.js";
import { pushFillNotification } from "../core/ntfy.js";
import { phoneBaseUrl } from "../core/baseUrl.js";

const requestBody = z.object({
  presetId: z.string().min(1),
});

/**
 * The Companion side of the fill flow (issue 003). Companion has no "open URL" action — a key
 * cannot open a browser anywhere, least of all on the operator's phone — so a key press instead
 * POSTs here. Two things then race to reach the operator: any open dashboard receives the
 * request over the state push and pops the fill popup (claiming it here), and, when configured,
 * an ntfy notification carries the `/fill` deep link to the phone.
 *
 * Same envelope contract as the action bus: always HTTP 200 with success/error in the body.
 */
export function fillRequestRouter(ctx: AppContext): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    try {
      const { presetId } = requestBody.parse(req.body);
      const preset = ctx.store.get().presets.find((p) => p.id === presetId);
      if (!preset) throw new AppError("INVALID_PRESET");
      const request = ctx.fills.request(presetId);
      ctx.logger.push({
        level: "info",
        category: "action",
        code: null,
        message: `Fill requested for “${preset.title}” — waiting for an operator to pick it up`,
      });
      const notify = ctx.store.get().notify;
      if (notify.ntfyTopic.trim()) {
        // The link has to be openable on the phone, not just on this box — see phoneBaseUrl.
        const base = phoneBaseUrl({
          publicBaseUrl: notify.publicBaseUrl,
          protocol: req.protocol,
          host: req.get("host"),
        });
        if (!base) {
          ctx.logger.push({
            level: "warn",
            category: "action",
            code: null,
            message:
              "Phone push skipped: this host is only reachable over localhost, so the link would " +
              "point at the phone itself. Set a Public base URL in the dashboard.",
          });
        } else {
          const delivered = await pushFillNotification(notify, preset, base);
          if (!delivered) {
            ctx.logger.push({
              level: "warn",
              category: "action",
              code: null,
              message: `ntfy push for “${preset.title}” failed — dashboard popup still pending`,
            });
          }
        }
      }
      res.json({ success: true, id: request.id });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.json(toErrorBody(new AppError("INVALID_REQUEST", err.issues[0]?.message)));
        return;
      }
      res.json(toErrorBody(err));
    }
  });

  // First dashboard to claim wins and pops the fill popup; everyone else stays quiet.
  router.post("/:id/claim", (req, res) => {
    res.json({ success: true, claimed: ctx.fills.claim(req.params.id) });
  });

  return router;
}

// Empty topic disables the push; the server must stay a URL so the fill link builder can trust it.
const notifyBody = z.object({
  ntfyServer: z
    .string()
    .trim()
    .transform((v) => (v === "" ? "https://ntfy.sh" : v))
    .pipe(z.string().url()),
  ntfyTopic: z.string().trim(),
  publicBaseUrl: z
    .string()
    .trim()
    .refine((v) => v === "" || z.string().url().safeParse(v).success, {
      message: "publicBaseUrl must be empty or a valid URL",
    }),
});

/** Phone-push (ntfy) config for the fill flow — same GET/PUT shape as the webhook route. */
export function notifyRouter(ctx: AppContext): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(ctx.store.get().notify);
  });

  router.put("/", async (req, res) => {
    try {
      const notify = notifySchema.parse(notifyBody.parse(req.body));
      await ctx.store.update((s) => {
        s.notify = notify;
      });
      res.json(ctx.store.get().notify);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json(toErrorBody(new AppError("INVALID_REQUEST", err.issues[0]?.message)));
        return;
      }
      res.status(400).json(toErrorBody(err));
    }
  });

  return router;
}
