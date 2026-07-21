/**
 * A pending invite the visitor opened while logged out. Stored in a first-party
 * cookie so the invite survives account creation (email sign-up, email
 * confirmation, or Google OAuth), then redeemed once the new account lands in
 * the app. The value is only an opaque invite token — the server re-validates
 * it on redemption, so a stale or forged cookie simply resolves to nothing.
 */
export const PENDING_INVITE_COOKIE = "mb_pending_invite";

// A week is plenty to finish signing up; the invite's own expiry is the real
// authority and is checked server-side when the prompt resolves it.
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function setPendingInviteCookie(token: string) {
  if (typeof document === "undefined" || !token) return;
  document.cookie = `${PENDING_INVITE_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
}

export function readPendingInviteCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${PENDING_INVITE_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function clearPendingInviteCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${PENDING_INVITE_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
