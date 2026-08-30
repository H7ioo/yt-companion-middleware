import { config as loadEnv } from "dotenv";
import path from "node:path";
import type { CredentialsState } from "./storage/schema.js";

loadEnv();

function optional(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface AppConfig {
  youtube: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  };
  port: number;
  dataDir: string;
  storePath: string;
  refreshIntervalMs: number;
  healthFailureThreshold: number;
  /** Region used to fetch the assignable video-category list (ISO 3166-1 alpha-2). */
  regionCode: string;
  /** Daily YouTube Data API quota budget in cost-weighted units (default 10,000). */
  quotaLimit: number;
  /**
   * The admin seeded at boot (PRD-15 §2). Null when unset, which leaves the deployment with no
   * accounts and authentication dormant — the desktop and LAN case. Setting both variables is
   * what turns authentication on, and it is deliberately the only way in: a hosted server must
   * never offer an open "claim this deployment" page to whoever reaches it first.
   */
  admin: { name: string; password: string } | null;
  /**
   * Express's `trust proxy` setting (PRD-15: Cloudflare terminates TLS in front of this origin).
   * Off by default — turning it on makes `X-Forwarded-For` authoritative for `req.ip`, and a
   * directly reachable server that trusts that header lets any caller mint a fresh sign-in
   * throttle key per attempt. Set TRUST_PROXY only when something you control is in front.
   */
  trustProxy: boolean | number | string;
}

/**
 * Loads runtime config. YouTube credentials are NOT required here: the desktop build can boot
 * without them and collect them through the setup screen. Any credential absent from the
 * environment is left blank and later resolved from the persisted store by {@link resolveCredentials}.
 */
export function loadConfig(): AppConfig {
  const dataDir = path.resolve(process.env.DATA_DIR?.trim() || "./data");
  return {
    youtube: {
      clientId: optional("YT_CLIENT_ID"),
      clientSecret: optional("YT_CLIENT_SECRET"),
      refreshToken: optional("YT_REFRESH_TOKEN"),
    },
    port: optionalInt("PORT", 8080),
    dataDir,
    storePath: path.join(dataDir, "store.json"),
    refreshIntervalMs: optionalInt("REFRESH_INTERVAL_SECONDS", 60) * 1000,
    healthFailureThreshold: optionalInt("HEALTH_FAILURE_THRESHOLD", 3),
    regionCode: (process.env.YT_REGION_CODE?.trim() || "US").toUpperCase(),
    quotaLimit: optionalInt("YT_QUOTA_LIMIT", 10000),
    admin: adminSeed(),
    trustProxy: trustProxySetting(),
  };
}

/**
 * TRUST_PROXY, in express's own vocabulary: unset/`false` trusts nobody (the default — the
 * desktop, LAN and direct-Docker cases), a number trusts that many hops, and anything else is
 * passed through as express understands it (`loopback`, a comma-separated address/subnet list).
 * `true` trusts every hop and is only safe when the origin is unreachable except through a proxy.
 */
function trustProxySetting(): AppConfig["trustProxy"] {
  const raw = optional("TRUST_PROXY");
  if (!raw || raw.toLowerCase() === "false") return false;
  if (raw.toLowerCase() === "true") return true;
  const hops = Number.parseInt(raw, 10);
  return String(hops) === raw ? hops : raw;
}

function adminSeed(): AppConfig["admin"] {
  const name = optional("ADMIN_USERNAME");
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (name && password) return { name, password };
  // Half a seed is never what anyone meant, and silently ignoring it boots a public host with no
  // accounts — which is to say wide open. Fail the same way a too-short password does.
  if (name || password) {
    const missing = name ? "ADMIN_PASSWORD" : "ADMIN_USERNAME";
    throw new Error(
      `${missing} is missing: set both ADMIN_USERNAME and ADMIN_PASSWORD to seed an admin, or neither to leave authentication off`,
    );
  }
  return null;
}

/**
 * Resolves the effective YouTube credentials: values saved through the setup screen take
 * precedence, falling back to the environment/.env for headless (Docker/CLI) deployments.
 */
export function resolveCredentials(
  config: AppConfig,
  stored: CredentialsState,
): AppConfig["youtube"] {
  return {
    clientId: stored.clientId || config.youtube.clientId,
    clientSecret: stored.clientSecret || config.youtube.clientSecret,
    refreshToken: stored.refreshToken || config.youtube.refreshToken,
  };
}

/** True when all three YouTube credentials are present, so the API client can be built. */
export function isConfigured(creds: AppConfig["youtube"]): boolean {
  return Boolean(creds.clientId && creds.clientSecret && creds.refreshToken);
}
