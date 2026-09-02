import type { youtube_v3 } from "googleapis";

// IngestionSnapshot is part of the shared API contract (the dashboard readout and the state push).
export type { IngestionSnapshot } from "@app/shared";
import type { IngestionSnapshot } from "@app/shared";

/**
 * "Is video actually arriving?" — the live ingestion readout that ends the other common Studio
 * trip (PRD-16 §3, issue 059).
 *
 * One key, by id, for one quota unit. Deliberately not the walk `listStreams` does: the question
 * is about the key the encoder pushes to, and reading forty of them to answer it would cost more
 * than the answer is worth on a poll.
 */
export async function readIngestion(
  yt: youtube_v3.Youtube,
  streamId: string,
  checkedAt: string,
): Promise<IngestionSnapshot | null> {
  const res = await yt.liveStreams.list({ part: ["snippet", "status"], id: [streamId] });
  const item = res.data.items?.[0];
  // The key was deleted, or belongs to another channel. Null rather than an all-null reading:
  // "nothing arriving on a key that does not exist" is a sentence with no meaning, and the caller
  // has a different thing to say about it.
  return item ? toIngestionSnapshot(item, checkedAt) : null;
}

/**
 * The contract shape of one reading, read straight off the resource. Kept pure and separate from
 * the call so the field mapping is pinned against recorded shapes rather than a live channel.
 */
export function toIngestionSnapshot(
  item: youtube_v3.Schema$LiveStream,
  checkedAt: string,
): IngestionSnapshot {
  const health = item.status?.healthStatus;
  return {
    streamId: item.id!,
    // A key with no title is named by its id, the same fallback the stream list uses — two
    // different names for one nameless key is how a panel and a dropdown start disagreeing.
    streamTitle: item.snippet?.title ?? item.id!,
    streamStatus: item.status?.streamStatus ?? null,
    healthStatus: health?.status ?? null,
    // Carried verbatim: this is YouTube telling the operator what to fix, in YouTube's words,
    // and paraphrasing it would strip the one actionable thing "arriving with problems" has.
    issues: (health?.configurationIssues ?? []).map((i) => ({
      severity: i.severity ?? null,
      reason: i.reason ?? null,
      description: i.description ?? null,
    })),
    checkedAt,
  };
}
