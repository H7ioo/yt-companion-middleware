/**
 * Test 3 (issue 060): does a broadcast THIS APP creates win the go-live?
 *
 * Rounds 1 and 2 proved a Studio-created broadcast, bound to the reusable key with auto-start on,
 * airs. A broadcast we insert ourselves has never been tested. This script is the measurement —
 * throwaway diagnostic, not product code. It touches no app code path.
 *
 * Two phases:
 *
 *   node scripts/test3-app-created-broadcast.mjs streams
 *       List the channel's ingestion keys, so you can pick the one OBS already holds.
 *
 *   node scripts/test3-app-created-broadcast.mjs prepare --stream <streamId> [--title "..."]
 *       Insert a broadcast, bind it to that stream, set enableAutoStart/enableAutoStop.
 *       Records insert eligibility and the verbatim refusal if YouTube says no.
 *
 *   node scripts/test3-app-created-broadcast.mjs watch
 *       Poll every broadcast on the channel until one goes live. Records which one aired,
 *       the title on its first frame, and how long ours took from prepare to first frame.
 *
 * Findings append to scripts/test3-findings.json. Reads YT_* from .env.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { config as loadEnv } from "dotenv";

// .env lives at the monorepo root, so this runs from either the repo root or packages/server.
// fileURLToPath, not .pathname: a checkout path with a space would arrive percent-encoded.
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const FINDINGS = fileURLToPath(new URL("./test3-findings.json", import.meta.url));
const POLL_SECONDS = 10;
const WATCH_MINUTES = 45;

const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
  console.error("Missing YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN in .env");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
oauth2.setCredentials({ refresh_token: YT_REFRESH_TOKEN });
const yt = google.youtube({ version: "v3", auth: oauth2 });

/** Everything worth knowing about a failure, kept verbatim — issue 060 asks for the exact refusal. */
function describeError(err) {
  const data = err?.response?.data?.error;
  return {
    status: err?.response?.status ?? err?.code ?? null,
    reason: data?.errors?.[0]?.reason ?? null,
    message: data?.message ?? err?.message ?? String(err),
    verbatim: data ?? null,
  };
}

/**
 * Merges into the existing key rather than replacing it: the findings file carries hand-added
 * fields (the rival broadcast, the notes) that a re-run must not destroy.
 */
function record(key, value) {
  const all = existsSync(FINDINGS) ? JSON.parse(readFileSync(FINDINGS, "utf8")) : {};
  const prev = all[key];
  const mergeable = (v) => v && typeof v === "object" && !Array.isArray(v);
  all[key] = mergeable(prev) && mergeable(value) ? { ...prev, ...value } : value;
  writeFileSync(FINDINGS, JSON.stringify(all, null, 2) + "\n");
  console.log(`\n[recorded: ${key} -> ${FINDINGS}]`);
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`--${name} needs a value.`);
    process.exit(1);
  }
  return value;
}

async function whoami() {
  const ch = await yt.channels.list({ part: ["snippet", "statistics"], mine: true });
  const c = ch.data.items?.[0];
  console.log(
    `Channel: ${c?.snippet?.title ?? "(none)"}  id=${c?.id ?? "?"}  subs=${c?.statistics?.subscriberCount ?? "?"}`,
  );
  return c;
}

async function cmdStreams() {
  await whoami();
  const res = await yt.liveStreams.list({ part: ["snippet", "cdn", "status"], mine: true, maxResults: 50 });
  const items = res.data.items ?? [];
  console.log(`\n${items.length} ingestion key(s):`);
  for (const s of items) {
    console.log(
      `  - id=${s.id}\n      title=${JSON.stringify(s.snippet?.title)}` +
        `\n      streamName=${s.cdn?.ingestionInfo?.streamName}` +
        `\n      isDefaultStream=${s.snippet?.isDefaultStream ?? "?"}  status=${s.status?.streamStatus}`,
    );
  }
  console.log("\nPick the key OBS already holds (match streamName against OBS's stream key),");
  console.log("then: node scripts/test3-app-created-broadcast.mjs prepare --stream <id>");
}

async function cmdPrepare() {
  const streamId = arg("stream");
  if (!streamId) {
    console.error("Usage: prepare --stream <streamId> [--title '...'] [--privacy unlisted] [--start-in 15]");
    process.exit(1);
  }
  const title = arg("title", `TEST 3 — app-created broadcast ${new Date().toISOString().slice(0, 16)}`);
  const privacy = arg("privacy", "unlisted");
  const startIn = Number(arg("start-in", "15"));
  const scheduledStartTime = new Date(Date.now() + startIn * 60_000).toISOString();

  await whoami();
  console.log(`\nInserting: title=${JSON.stringify(title)} privacy=${privacy} start=${scheduledStartTime}`);
  console.log("Cost: insert 50 units + bind 50 units.\n");

  let created;
  try {
    const res = await yt.liveBroadcasts.insert({
      part: ["snippet", "status", "contentDetails"],
      requestBody: {
        snippet: {
          title,
          description: "Issue 060 / Test 3. Does an app-created broadcast win the go-live?",
          scheduledStartTime,
        },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
        contentDetails: {
          enableAutoStart: true,
          enableAutoStop: true,
        },
      },
    });
    created = res.data;
  } catch (err) {
    const detail = describeError(err);
    console.error("INSERT REFUSED:", JSON.stringify(detail, null, 2));
    record("insertEligibility", { permitted: false, refusal: detail, at: new Date().toISOString() });
    console.error("\nThis channel cannot create broadcasts — riding mode (issue 061) is the real state.");
    console.error("PRD-16's creation half is dead; the reason above is the shape issue 061 must match.");
    process.exit(2);
  }

  // Recorded here, not after the bind: a bind failure must not leave a stale `permitted: false`
  // from an earlier run standing as the answer to the one question issue 060 turns on.
  record("insertEligibility", { permitted: true, refusal: null, at: new Date().toISOString() });

  console.log(`Inserted id=${created.id}  life=${created.status?.lifeCycleStatus}`);
  console.log(`  enableAutoStart returned: ${created.contentDetails?.enableAutoStart}`);
  console.log(`  enableAutoStop  returned: ${created.contentDetails?.enableAutoStop}`);
  console.log(
    `  monitorStream.enableMonitorStream: ${created.contentDetails?.monitorStream?.enableMonitorStream}`,
  );

  let bound;
  try {
    const res = await yt.liveBroadcasts.bind({
      part: ["id", "contentDetails", "status"],
      id: created.id,
      streamId,
    });
    bound = res.data;
    console.log(`\nBound to stream ${streamId}. boundStreamId=${bound.contentDetails?.boundStreamId}`);
  } catch (err) {
    const detail = describeError(err);
    console.error("BIND FAILED:", JSON.stringify(detail, null, 2));
    record("bind", { ok: false, broadcastId: created.id, refusal: detail });
    process.exit(3);
  }

  // Re-read: bind can change contentDetails, and the AC asks how auto-start and monitor-stream coexist.
  const after = (
    await yt.liveBroadcasts.list({ part: ["id", "snippet", "status", "contentDetails"], id: [created.id] })
  ).data.items?.[0];

  record("prepared", {
    broadcastId: created.id,
    streamId,
    title,
    privacy,
    scheduledStartTime,
    watchUrl: `https://www.youtube.com/watch?v=${created.id}`,
    preparedAt: new Date().toISOString(),
    autoStartMonitorInteraction: {
      enableAutoStart: after?.contentDetails?.enableAutoStart ?? null,
      enableAutoStop: after?.contentDetails?.enableAutoStop ?? null,
      enableMonitorStream: after?.contentDetails?.monitorStream?.enableMonitorStream ?? null,
      broadcastStreamDelayMs: after?.contentDetails?.monitorStream?.broadcastStreamDelayMs ?? null,
      lifeCycleStatus: after?.status?.lifeCycleStatus ?? null,
    },
  });

  console.log(`\nWatch URL: https://www.youtube.com/watch?v=${created.id}`);
  console.log("\nNEXT: start the watcher, THEN start OBS.");
  console.log("  node scripts/test3-app-created-broadcast.mjs watch");
}

async function cmdWatch() {
  const all = existsSync(FINDINGS) ? JSON.parse(readFileSync(FINDINGS, "utf8")) : {};
  const ours = all.prepared?.broadcastId ?? null;
  console.log(ours ? `Watching. Ours is ${ours}.` : "Watching. No prepared broadcast recorded — watching all.");
  console.log(`Polling every ${POLL_SECONDS}s for up to ${WATCH_MINUTES} min. Start OBS now. Ctrl-C to stop.\n`);

  const timeline = [];
  const seen = new Map();
  const started = Date.now();
  let winner = null;

  const save = makeSaver(timeline, ours);
  process.on("SIGINT", () => {
    console.log("\n\nInterrupted — writing what was observed so far.");
    save();
    process.exit(0);
  });

  while (Date.now() - started < WATCH_MINUTES * 60_000) {
    const at = new Date().toISOString();
    let items = [];
    try {
      items = await listBroadcasts(ours);
    } catch (err) {
      const error = describeError(err);
      timeline.push({ at, error });
      // Printed, not only recorded: a revoked token or spent quota must not look like a quiet
      // channel while the operator sits there holding OBS live.
      console.error(`${at}  POLL ERROR ${error.status ?? ""} ${error.reason ?? ""} ${error.message}`);
    }

    for (const b of items) {
      const life = b.status?.lifeCycleStatus;
      const key = `${b.id}:${life}:${b.snippet?.title}`;
      if (seen.get(b.id) === key) continue;
      seen.set(b.id, key);
      const mine = b.id === ours;
      const entry = {
        at,
        id: b.id,
        ours: mine,
        lifeCycleStatus: life,
        title: b.snippet?.title,
        actualStartTime: b.snippet?.actualStartTime ?? null,
        boundStreamId: b.contentDetails?.boundStreamId ?? null,
      };
      timeline.push(entry);
      console.log(
        `${at}  ${mine ? "OURS " : "     "}${b.id}  ${life}` +
          `  title=${JSON.stringify(b.snippet?.title)}`,
      );
      if (life === "live" && !winner) {
        winner = entry;
        console.log(`\n*** WENT LIVE: ${b.id} ${mine ? "(OURS — app-created broadcast wins)" : "(NOT ours)"}`);
        console.log(`*** Title on air: ${JSON.stringify(b.snippet?.title)}\n`);
      }
    }

    await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
  }

  save();
  console.log("\nDone. Findings written. Paste them back and I will write the result into PRD-16.");
}

/**
 * The rival broadcast matters as much as ours — the test is which one wins — so we page the whole
 * channel rather than reading page one. And we ask for ours by id on top of that: on a channel with
 * a long broadcast history a single unpaged page could leave ours out and every poll would miss it.
 */
async function listBroadcasts(ours) {
  const part = ["id", "snippet", "status", "contentDetails"];
  const byId = new Map();

  let pageToken;
  do {
    const res = await yt.liveBroadcasts.list({ part, broadcastStatus: "all", maxResults: 50, pageToken });
    for (const b of res.data.items ?? []) byId.set(b.id, b);
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  if (ours && !byId.has(ours)) {
    const res = await yt.liveBroadcasts.list({ part, id: [ours] });
    for (const b of res.data.items ?? []) byId.set(b.id, b);
  }
  return [...byId.values()];
}

/** Ctrl-C is the normal way this ends, so the result must survive it — not only a clean timeout. */
function makeSaver(timeline, ours) {
  let saved = false;
  return function save() {
    if (saved) return;
    saved = true;
    const wentLive = timeline.find((e) => e.ours && e.lifeCycleStatus === "live");
    // Anchored on when we prepared it, not on the first poll: ours is already "ready" by the time
    // the watcher starts, so the first "ready" entry would only measure watcher uptime.
    const all = existsSync(FINDINGS) ? JSON.parse(readFileSync(FINDINGS, "utf8")) : {};
    const preparedAt = all.prepared?.broadcastId === ours ? (all.prepared?.preparedAt ?? null) : null;
    const winner = timeline.find((e) => e.lifeCycleStatus === "live") ?? null;
    record("goLive", {
      winner,
      winnerWasOurs: winner ? winner.ours : null,
      titleOnFirstFrame: winner?.title ?? null,
      preparedToLiveSeconds:
        preparedAt && wentLive ? (Date.parse(wentLive.at) - Date.parse(preparedAt)) / 1000 : null,
      ours,
      timeline,
    });
  };
}

const cmd = process.argv[2];
if (cmd === "streams") await cmdStreams();
else if (cmd === "prepare") await cmdPrepare();
else if (cmd === "watch") await cmdWatch();
else {
  console.error("Usage: node scripts/test3-app-created-broadcast.mjs <streams|prepare|watch>");
  process.exit(1);
}
