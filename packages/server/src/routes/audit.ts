import { Router } from "express";
import type { AuditLog } from "../audit/log.js";

/**
 * The audit-log viewer (issue 050, PRD-15 §3).
 *
 * Read-only, and admin-only — stated once in `ADMIN_ONLY` in app.ts rather than guarded here, the
 * way every other admin route in this app states it. Reading who did what is squarely on the
 * "losing control of the server" side of the PRD's dividing line: it names every account on the
 * deployment and every machine attached to it.
 *
 * There is no delete. An audit log with a clear button is a log an admin can edit after the fact,
 * and retention already stops it growing without bound.
 */

/** Entries returned when the caller asks for no particular number. */
const DEFAULT_LIMIT = 200;
/** The most one request will return, however large a number is asked for. */
const MAX_LIMIT = 1000;

export interface AuditDeps {
  audit: AuditLog;
}

export function auditRouter({ audit }: AuditDeps): Router {
  const router = Router();

  /**
   * The log, newest first. `notable=1` narrows it to the account and role changes — the entries
   * PRD-15 §3 says someone will actually come looking for, and the reason the flag is on the
   * entry rather than worked out by the viewer.
   */
  router.get("/", (req, res, next) => {
    const asked = Number(req.query.limit);
    const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;
    const notableOnly = req.query.notable === "1" || req.query.notable === "true";
    void audit
      .list(limit, { notableOnly })
      .then((entries) => {
        res.json({ entries });
      })
      .catch(next);
  });

  return router;
}
