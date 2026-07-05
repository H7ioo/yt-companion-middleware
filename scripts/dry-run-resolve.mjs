/**
 * Dry-run: GET a real broadcast, run the SAME resolve() the app uses, and diff what the
 * PUT would send vs. what YouTube returned — proving no required field is dropped.
 * Nothing is written back.
 *
 * Run:  node scripts/dry-run-resolve.mjs <broadcastId>
 */
import { google } from "googleapis";
import { config as loadEnv } from "dotenv";
import { resolve } from "../dist/core/resolve.js";

loadEnv();

const id = process.argv[2];
if (!id) {
  console.error("Usage: node scripts/dry-run-resolve.mjs <broadcastId>");
  process.exit(1);
}

const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
const oauth2 = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
oauth2.setCredentials({ refresh_token: YT_REFRESH_TOKEN });
const yt = google.youtube({ version: "v3", auth: oauth2 });

const res = await yt.liveBroadcasts.list({
  part: ["id", "snippet", "status", "contentDetails"],
  id: [id],
});
const current = res.data.items?.[0];
if (!current) {
  console.error(`Broadcast ${id} not found`);
  process.exit(1);
}

const plan = resolve(current, { title: "TEST TITLE", privacyStatus: "unlisted" }, {
  defaultCategory: null,
  defaultStreamBoundId: null,
});

const REQUIRED = [
  ["snippet.scheduledStartTime", current.snippet?.scheduledStartTime, plan.broadcast.snippet?.scheduledStartTime],
  ["contentDetails.monitorStream.enableMonitorStream", current.contentDetails?.monitorStream?.enableMonitorStream, plan.broadcast.contentDetails?.monitorStream?.enableMonitorStream],
  ["contentDetails.monitorStream.broadcastStreamDelayMs", current.contentDetails?.monitorStream?.broadcastStreamDelayMs, plan.broadcast.contentDetails?.monitorStream?.broadcastStreamDelayMs],
];

console.log("=== Required fields (must be identical GET -> PUT) ===");
for (const [name, got, put] of REQUIRED) {
  const ok = JSON.stringify(got) === JSON.stringify(put);
  console.log(`  ${ok ? "OK " : "!! "} ${name}: GET=${JSON.stringify(got)}  PUT=${JSON.stringify(put)}`);
}

console.log("\n=== Passthrough sample (fields we must NOT touch) ===");
console.log("  thumbnails present:", Boolean(current.snippet?.thumbnails), "->", Boolean(plan.broadcast.snippet?.thumbnails));
console.log("  scheduledEndTime:", JSON.stringify(plan.broadcast.snippet?.scheduledEndTime));
console.log("  enableAutoStart:", JSON.stringify(plan.broadcast.contentDetails?.enableAutoStart));
console.log("  enableDvr:", JSON.stringify(plan.broadcast.contentDetails?.enableDvr));

console.log("\n=== Owned fields (should reflect our overlay) ===");
console.log("  title:", JSON.stringify(current.snippet?.title), "->", JSON.stringify(plan.broadcast.snippet?.title));
console.log("  privacyStatus:", JSON.stringify(current.status?.privacyStatus), "->", JSON.stringify(plan.broadcast.status?.privacyStatus));

console.log("\nsnippet keys:", Object.keys(plan.broadcast.snippet ?? {}).join(", "));
console.log("contentDetails keys:", Object.keys(plan.broadcast.contentDetails ?? {}).join(", "));
