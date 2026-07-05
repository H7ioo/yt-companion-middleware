import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv();

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
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

export function loadConfig(): AppConfig {
  const dataDir = path.resolve(process.env.DATA_DIR?.trim() || "./data");
  return {
    youtube: {
      clientId: required("YT_CLIENT_ID"),
      clientSecret: required("YT_CLIENT_SECRET"),
      refreshToken: required("YT_REFRESH_TOKEN"),
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
