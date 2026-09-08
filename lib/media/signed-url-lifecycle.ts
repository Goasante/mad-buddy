export const SIGNED_URL_REFRESH_SKEW_MS = 15_000;

/**
 * Signed URLs are credentials, not durable media identity.
 *
 * A client should renew shortly before expiry rather than deliberately render
 * a dead URL and wait for an <img> error. Missing or malformed expiry metadata
 * also fails toward renewal: the canonical media id remains the identity and
 * the server can decide whether a fresh URL may still be minted.
 */
export function signedUrlNeedsRefresh(
  expiresAt: string | null | undefined,
  hasUsableUrl: boolean,
  nowMs = Date.now(),
  skewMs = SIGNED_URL_REFRESH_SKEW_MS
): boolean {
  if (!hasUsableUrl) return true;
  const expiresMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresMs)) return true;
  return expiresMs <= nowMs + Math.max(0, skewMs);
}
