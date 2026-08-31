import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AuditActor, AuditEntry, AuditOutcome } from "@app/shared";

export type { AuditActor, AuditEntry, AuditOutcome } from "@app/shared";

/**
 * The durable audit log (issue 050, PRD-15 §3): a record of what a *person* did that survives a
 * restart, kept deliberately apart from the activity feed in `core/logger.ts`.
 *
 * The two are not the same log wearing different hats. The feed is a 200-entry in-memory ring
 * buffer and wants noise — polls, refreshes, health transitions — so it can be watched live. This
 * wants only human actions, on disk, for months, so it can be searched later. One store serving
 * both gives a feed too quiet to watch and a log too noisy to search, which is why the feed is
 * left exactly as it is.
 *
 * **A file of JSON lines, not a slice of `store.json`.** Every store write rewrites the whole
 * document; appending an audit entry per action there would rewrite the store on every cue of
 * every show. Appending a line does not touch what is already on disk, which is also the closest
 * thing a single file offers to append-only.
 */

/** How long an entry is kept before it is trimmed (PRD-15 §3, "retention ~90 days"). */
export const RETENTION_DAYS = 90;
/**
 * A ceiling on lines regardless of age. Retention alone bounds the log by *time*, and a runaway
 * loop can write a great deal inside ninety days; this bounds it by size as well.
 */
const MAX_ENTRIES = 20_000;
/** Longest string kept in a detail payload. A caller controls these; the log should not grow with them. */
const MAX_STRING = 300;
/** Deepest a detail payload is walked before it is summarised. */
const MAX_DEPTH = 4;
/** Most keys/items kept at one level. */
const MAX_KEYS = 40;
/** How often the retention sweep runs while the process is up. Also runs on the first write. */
const TRIM_INTERVAL_MS = 60 * 60 * 1000;

/** What a caller hands {@link AuditLog.append}; everything else is derived here. */
export interface AuditInput {
  actor: AuditActor;
  method: string;
  /** The path as called, ids and all. Query strings are dropped before this. */
  path: string;
  status: number;
  /** The request body, if any. Redacted here — callers pass it through untouched. */
  body?: unknown;
  /** Overrides the derived label, for the rare route whose meaning the path does not carry. */
  action?: string;
  target?: string | null;
  notable?: boolean;
}

export class AuditLog {
  private readonly filePath: string;
  private readonly now: () => number;
  private readonly retentionMs: number;
  /** Serializes appends and trims, so a sweep can never interleave with a write. */
  private chain: Promise<unknown> = Promise.resolve();
  private lastTrimAt = 0;

  constructor(filePath: string, opts: { now?: () => number; retentionDays?: number } = {}) {
    this.filePath = filePath;
    this.now = opts.now ?? Date.now;
    this.retentionMs = (opts.retentionDays ?? RETENTION_DAYS) * 24 * 60 * 60 * 1000;
  }

  /** Where the log lives, for the boot banner. */
  get path(): string {
    return this.filePath;
  }

  /**
   * Appends one entry. Returns what was stored, so a caller can assert on it.
   *
   * Failure is reported and swallowed by {@link AuditLog.record} rather than thrown at a caller
   * mid-action — see there for why.
   */
  async append(input: AuditInput): Promise<AuditEntry> {
    const described = describeAction(input.method, input.path);
    const entry: AuditEntry = {
      id: randomUUID(),
      ts: new Date(this.now()).toISOString(),
      actor: input.actor,
      action: input.action ?? described.action,
      method: input.method,
      path: input.path,
      target: input.target !== undefined ? input.target : described.target,
      outcome: outcomeOf(input.status),
      status: input.status,
      detail: detailOf(input.body),
      notable: input.notable ?? described.notable,
    };

    await this.run(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
      await this.sweep();
    });
    return entry;
  }

  /**
   * Appends without making the failure the caller's problem.
   *
   * The middleware calls this from a response that has already been sent: there is nobody left to
   * tell, and an unhandled rejection would take the process down over a bookkeeping write. A disk
   * that cannot be written to is a real problem, and it belongs in the console, not in a 500 on a
   * cue that otherwise worked.
   */
  record(input: AuditInput): void {
    void this.append(input).catch((err: unknown) => {
      console.error("[audit] failed to record an entry:", err);
    });
  }

  /**
   * Resolves once every append handed over so far has landed on disk.
   *
   * {@link AuditLog.record} deliberately does not make the caller wait — the response has already
   * gone — so there has to be something for a shutdown, or a test, to wait on. Without it the
   * only way to observe a write is to sleep and hope.
   */
  async settled(): Promise<void> {
    await this.chain.catch(() => undefined);
  }

  /** The entries on disk, newest first, capped at `limit`. */
  async list(limit = 200): Promise<AuditEntry[]> {
    const entries = await this.read();
    return entries.reverse().slice(0, Math.max(0, limit));
  }

  /** Drops everything past the retention window (and past the hard cap). Returns what remains. */
  async trim(): Promise<number> {
    let remaining = 0;
    await this.run(async () => {
      remaining = await this.sweep(true);
    });
    return remaining;
  }

  /** Reads and parses the file, oldest first, skipping any line that is not a whole entry. */
  private async read(): Promise<AuditEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const entries: AuditEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        // A crash mid-append leaves a half-written line. Losing it is the cost; losing every
        // entry before it because one line would not parse is not.
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        continue;
      }
    }
    return entries;
  }

  /**
   * Applies retention, rewriting the file only when something actually goes. Called inside the
   * write chain, so it never races an append.
   */
  private async sweep(force = false): Promise<number> {
    const now = this.now();
    if (!force && now - this.lastTrimAt < TRIM_INTERVAL_MS) return -1;
    this.lastTrimAt = now;

    const entries = await this.read();
    const cutoff = now - this.retentionMs;
    const kept = entries
      .filter((e) => {
        const ts = Date.parse(e.ts);
        // An unparseable timestamp is kept: dropping an entry because its clock is unreadable is
        // the one deletion an audit log should never make on its own.
        return Number.isNaN(ts) || ts >= cutoff;
      })
      .slice(-MAX_ENTRIES);
    if (kept.length !== entries.length) {
      // Same atomic dance as the store: write beside it, then rename over it, so a crash mid-trim
      // leaves the untrimmed log rather than half a log.
      const tmp = `${this.filePath}.tmp`;
      await fs.writeFile(tmp, kept.map((e) => `${JSON.stringify(e)}\n`).join(""), "utf8");
      await fs.rename(tmp, this.filePath);
    }
    return kept.length;
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }
}

/** 2xx/3xx is done; 401/403 is the guard saying no; anything else is this server failing. */
function outcomeOf(status: number): AuditOutcome {
  if (status < 400) return "ok";
  if (status === 401 || status === 403) return "refused";
  return "failed";
}

/**
 * Keys whose *value* never reaches the log. Matched on the key, not the value, because a secret
 * is not recognisable by looking at it — and a log is the thing most likely to be copied into a
 * chat window, a ticket, or a support email (PRD-15 §3).
 */
const SECRET_KEY = /token|secret|password|passphrase|credential|authorization|auth_?key|api_?key/i;
const REDACTED = "[redacted]";

/** A body reduced to something safe and bounded to store. Null when there is nothing worth keeping. */
function detailOf(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const out = redact(body as Record<string, unknown>);
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Copies a payload with every secret-shaped value replaced, strings truncated, and depth, breadth
 * and cycles bounded. Exported because it is the acceptance criterion this slice is judged on and
 * deserves its own tests.
 */
export function redact(body: Record<string, unknown>): Record<string, unknown> {
  return walk(body, 0, new WeakSet()) as Record<string, unknown>;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[…]";
  // A cycle is not a hostile payload, just a shape JSON.stringify would throw on.
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_KEYS).map((item) => walk(item, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : walk(item, depth + 1, seen);
  }
  return out;
}

/** What a route is called in the log, what it acted on, and whether anyone will come looking. */
export interface ActionDescription {
  action: string;
  target: string | null;
  notable: boolean;
}

/**
 * One row of the naming table: the method, a pattern over the path, and what to call it.
 *
 * Ordered, and the order matters — `/people/invites/:id` and `/people/:id` are the same shape, so
 * the specific one has to be asked first or cancelling an invite is recorded as removing a person.
 */
const ROUTES: ReadonlyArray<{
  method: string;
  pattern: RegExp;
  action: string;
  notable: boolean;
}> = [
  // Account and role changes — the entries PRD-15 §3 says matter most.
  { method: "PUT", pattern: /^\/api\/dashboard\/people\/([^/]+)\/role$/, action: "changed a role", notable: true },
  { method: "POST", pattern: /^\/api\/dashboard\/people\/invites$/, action: "created an invite", notable: true },
  { method: "DELETE", pattern: /^\/api\/dashboard\/people\/invites\/([^/]+)$/, action: "cancelled an invite", notable: true },
  { method: "DELETE", pattern: /^\/api\/dashboard\/people\/([^/]+)\/sessions\/([^/]+)$/, action: "signed a device out", notable: true },
  { method: "DELETE", pattern: /^\/api\/dashboard\/people\/([^/]+)$/, action: "removed an account", notable: true },
  // Credentials for machines.
  { method: "POST", pattern: /^\/api\/dashboard\/devices$/, action: "created a device token", notable: true },
  { method: "DELETE", pattern: /^\/api\/dashboard\/devices\/([^/]+)$/, action: "revoked a device token", notable: true },
  // Sign-in and the invite path into it. The actor on these is anonymous by definition — nobody
  // has a session yet — so the name attempted is carried as the target instead.
  { method: "POST", pattern: /^\/api\/auth\/login$/, action: "signed in", notable: true },
  { method: "POST", pattern: /^\/api\/auth\/invite$/, action: "redeemed an invite", notable: true },
  { method: "POST", pattern: /^\/api\/auth\/logout$/, action: "signed out", notable: false },
  { method: "POST", pattern: /^\/api\/auth\/reauth$/, action: "renewed a session", notable: true },
  // The YouTube connection. Getting these wrong loses the channel, not one stream.
  { method: "POST", pattern: /^\/api\/setup$/, action: "changed the YouTube credentials", notable: true },
  { method: "POST", pattern: /^\/api\/setup\/oauth\/start$/, action: "connected YouTube", notable: true },
  { method: "POST", pattern: /^\/api\/setup\/disconnect$/, action: "disconnected YouTube", notable: true },
  // Running the show: recorded, because "who changed the title" is a real question, but routine.
  { method: "POST", pattern: /^\/api(\/dashboard)?\/action\/preset$/, action: "ran a preset", notable: false },
  { method: "POST", pattern: /^\/api(\/dashboard)?\/action\/update$/, action: "changed the broadcast details", notable: false },
  { method: "POST", pattern: /^\/api(\/dashboard)?\/action\/privacy$/, action: "changed the privacy", notable: false },
  { method: "POST", pattern: /^\/api(\/dashboard)?\/action\/undo$/, action: "undid the last change", notable: false },
  { method: "POST", pattern: /^\/api(\/dashboard)?\/action\/refresh$/, action: "refreshed from YouTube", notable: false },
  { method: "PUT", pattern: /^\/api\/dashboard\/target$/, action: "changed the go-live target", notable: false },
  { method: "PUT", pattern: /^\/api\/dashboard\/settings$/, action: "changed the settings", notable: false },
  { method: "PUT", pattern: /^\/api\/dashboard\/service$/, action: "changed the service switch", notable: false },
  { method: "POST", pattern: /^\/api\/dashboard\/presets$/, action: "created a preset", notable: false },
  { method: "PUT", pattern: /^\/api\/dashboard\/presets\/([^/]+)$/, action: "changed a preset", notable: false },
  { method: "DELETE", pattern: /^\/api\/dashboard\/presets\/([^/]+)$/, action: "deleted a preset", notable: false },
  { method: "POST", pattern: /^\/api\/dashboard\/presets\/import$/, action: "imported presets", notable: false },
  { method: "POST", pattern: /^\/api\/dashboard\/fill-request$/, action: "requested a fill", notable: false },
];

/**
 * Names a request. Anything the table does not know falls back to `METHOD /path` — an unlabelled
 * entry that is still a complete record, which is the right failure for a route added later
 * without anyone remembering this file.
 */
export function describeAction(method: string, requestPath: string): ActionDescription {
  const upper = method.toUpperCase();
  // Trailing slashes are a caller's punctuation, not a different route.
  const clean = requestPath.length > 1 ? requestPath.replace(/\/+$/, "") : requestPath;
  for (const route of ROUTES) {
    if (route.method !== upper) continue;
    const m = route.pattern.exec(clean);
    if (!m) continue;
    // The last capture is the thing acted on: for `/people/:id/sessions/:sessionId` that is the
    // device, which is what was actually cut off.
    const target = m.slice(1).filter((g) => g !== undefined && !g.startsWith("/")).pop() ?? null;
    return { action: route.action, target, notable: route.notable };
  }
  return { action: `${upper} ${clean}`, target: null, notable: false };
}
