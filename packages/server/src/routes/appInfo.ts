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
