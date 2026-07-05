import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { JsonStore } from "../storage/jsonStore.js";

/**
 * Local API Bearer-token management (PRD §5.2). The token is generated once, stored
 * hashed in the JSON store, and the plaintext is returned to the operator exactly once
 * at generation time.
 */

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of two hex-encoded hashes. */
function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Generates a new token, persists its hash (invalidating the old one), returns plaintext. */
export async function regenerateToken(store: JsonStore): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const hash = hashToken(token);
  await store.update((s) => {
    s.token = { hash, createdAt: new Date().toISOString() };
  });
  return token;
}

export function verifyToken(store: JsonStore, presented: string): boolean {
  const record = store.get().token;
  if (!record.hash) return false;
  return hashesEqual(hashToken(presented), record.hash);
}

export interface TokenStatus {
  configured: boolean;
  createdAt: string | null;
}

export function tokenStatus(store: JsonStore): TokenStatus {
  const record = store.get().token;
  return { configured: record.hash !== null, createdAt: record.createdAt };
}
