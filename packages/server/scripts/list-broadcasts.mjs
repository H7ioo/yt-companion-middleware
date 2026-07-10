/**
 * Diagnostic: print every broadcast the authenticated channel exposes, so you can see
 * what the middleware's resolveTarget has to work with.
 *
 * Run:  node scripts/list-broadcasts.mjs
 * Reads YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN from .env.
 */
import { google } from "googleapis";
import { config as loadEnv } from "dotenv";

loadEnv();

const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
  console.error("Missing YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN in .env");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
oauth2.setCredentials({ refresh_token: YT_REFRESH_TOKEN });
const yt = google.youtube({ version: "v3", auth: oauth2 });

async function list(label, params) {
  try {
    const res = await yt.liveBroadcasts.list({
      part: ["id", "snippet", "status", "contentDetails"],
      ...params,
    });
    const items = res.data.items ?? [];
    console.log(`\n[${label}] ${items.length} item(s)`);
    for (const b of items) {
      console.log(
        `  - id=${b.id}  life=${b.status?.lifeCycleStatus}  privacy=${b.status?.privacyStatus}` +
          `  title=${JSON.stringify(b.snippet?.title)}`,
      );
    }
  } catch (err) {
    const status = err?.response?.status ?? err?.code;
    const reason = err?.response?.data?.error?.errors?.[0]?.reason;
    console.log(`\n[${label}] ERROR status=${status} reason=${reason} — ${err?.message}`);
  }
}

// Whoami — confirms which channel the token authenticates as.
try {
  const ch = await yt.channels.list({ part: ["snippet"], mine: true });
  const c = ch.data.items?.[0];
  console.log(`Authenticated channel: ${c?.snippet?.title ?? "(none)"}  id=${c?.id ?? "?"}`);
} catch (err) {
  console.log(`channels.list failed: ${err?.message}`);
}

// broadcastStatus and mine are mutually exclusive (API 400), so status queries omit it.
await list("all", { broadcastStatus: "all" });
await list("active", { broadcastStatus: "active" });
await list("upcoming", { broadcastStatus: "upcoming" });
await list("completed", { broadcastStatus: "completed" });
await list("persistent (mine)", { broadcastType: "persistent", mine: true });
