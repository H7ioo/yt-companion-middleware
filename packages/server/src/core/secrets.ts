/**
 * A scrubber for credential values on their way out of the process (issue 067, PRD-15 §Further
 * Notes).
 *
 * `audit/log.ts` already redacts by *key*, which is the right move for a request body whose shape
 * is known. This is the other half, and it works by *value*, because the strings this guards are
 * not structured: an error message from googleapis, a line a producer pushed into the activity
 * feed. Nobody building those strings is thinking about credentials, and a token pasted into a
 * ticket or a screenshot is as compromising as the file it came from.
 *
 * Keeping the plaintext store (issue 042) is only defensible if the token is genuinely confined to
 * that file. This is what confines it.
 */

/**
 * Below this length a "secret" matches ordinary prose and the scrubber does more damage than the
 * leak would — redacting every "ab" in a log is not a security control.
 */
const MIN_LENGTH = 8;
const REDACTED = "[redacted]";

/** The live credential values. A Set, so re-registering the same token on a hot reload is free. */
const secrets = new Set<string>();

/**
 * Registers a value that must never appear in outbound text. Called wherever credentials are
 * resolved or replaced; harmless to call repeatedly with the same value.
 */
export function rememberSecret(value: string | null | undefined): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed.length < MIN_LENGTH) return;
  secrets.add(trimmed);
}

/** Drops every registered value. For a disconnect, and for tests that must not leak into each other. */
export function forgetSecrets(): void {
  secrets.clear();
}

/** `text` with every registered credential value replaced. Anything else is returned unchanged. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  return out;
}
