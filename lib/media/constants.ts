/** One lifetime for every private media URL minted by Mad Buddy. */
export const MEDIA_SIGNED_URL_TTL_SECONDS = 5 * 60;

export function mediaSignedUrlExpiresAt(nowMs = Date.now()): string {
  return new Date(nowMs + MEDIA_SIGNED_URL_TTL_SECONDS * 1000).toISOString();
}

/** A ready attachment can remain unsent for a day before orphan collection. */
export const READY_CHAT_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/** Expired/incomplete upload intents receive a further two-hour safety window. */
export const INCOMPLETE_CHAT_ORPHAN_AGE_MS = 2 * 60 * 60 * 1000;

/** Signed upload intents are deliberately short lived. */
export const CHAT_UPLOAD_INTENT_TTL_MS = 15 * 60 * 1000;
