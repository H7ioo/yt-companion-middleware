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
  };
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
