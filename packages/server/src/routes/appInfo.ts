import { Router } from "express";
import type { AppInfo, ReleaseNotes, UpdateState } from "@app/shared";
import { findRelease } from "../core/changelog.js";

/**
 * The host's update capability (PRD-09 §A.1). Supplied by the Electron main process; absent on a
 * Docker/CLI boot, where there is no updater and the dashboard shows nothing about updates.
 */
export interface UpdateHost {
  getState(): UpdateState;
  /** Installs the downloaded update and restarts. Returns false when nothing is staged. */
  installAndRestart(): boolean;
  /** Operator-triggered re-check. Resolves to the state once the check settles. */
  check(): Promise<UpdateState>;
}

export interface AppInfoDeps {
  version: string;
  /** The bundled changelog, already parsed. Empty when the build carries none. */
  changelog: ReleaseNotes[];
  updates?: UpdateHost;
}

/**
 * GET /api/dashboard/app and the install trigger behind it (issue 040).
 *
 * Mounted in both boot modes — the What's New panel must work before YouTube is connected, since
 * the first launch after an update is often the first launch, full stop.
 */
export function appInfoRouter({ version, changelog, updates }: AppInfoDeps): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const update: UpdateState = updates?.getState() ?? { status: "unsupported" };
    const info: AppInfo = {
      version,
      // The running version's What's New — the bundled changelog is exactly right here: it always
      // matches the binary in front of the operator and works offline.
      notes: findRelease(changelog, version),
      update,
      // The offered version's notes come from the update feed, threaded through the updater state.
      // The bundled changelog can never carry them — this build predates that version (PRD-10 §3).
      updateNotes: update.notes ?? null,
    };
    res.json(info);
  });

  // Operator-triggered re-check (issue: the launch check is the only one, so a release published
  // while the app runs is invisible until restart). Answers with the settled state so the
  // dashboard can say "up to date" or "found one — downloading" without polling.
  router.post("/update/check", (_req, res) => {
    if (!updates) {
      res.status(409).json({ error: "This build does not update itself." });
      return;
    }
    void updates.check().then(
      (update) => res.json({ update }),
      () => res.status(500).json({ error: "Update check failed." }),
    );
  });

  // The one path to an install. Deliberately a POST the operator triggers — the app never restarts
  // itself, because a restart mid-stream is exactly what this updater exists to prevent.
  router.post("/update/install", (_req, res) => {
    if (!updates) {
      res.status(409).json({ error: "This build does not update itself." });
      return;
    }
    if (!updates.installAndRestart()) {
      res.status(409).json({ error: "No update is staged to install." });
      return;
    }
    res.status(202).json({ installing: true });
  });

  return router;
}
