"use client";

import { appCache } from "@/lib/cache/entity-cache";
import { imageRequests } from "@/lib/cache/image-requests";
import { subscribeToSessionEnd } from "@/lib/auth/client-session";

/**
 * Binds the client caches to the session's lifetime.
 *
 * Reuses the EXISTING session broadcast rather than adding a second logout
 * path: `announceSessionEnded` already clears user-scoped browser state and
 * notifies other tabs over BroadcastChannel, so the caches simply listen to
 * the same signal. One place decides that a session ended.
 *
 * Cross-tab matters here. Logging out in one tab must empty the caches in
 * every other tab of the same browser, or a background tab would keep
 * rendering the previous account's metadata until it was touched.
 */

/** Drop every cached entity and image URL. */
export function clearAllClientCaches(): void {
  // Bumping the authorisation version also strands any in-flight request, so
  // a response authorised under the old session cannot be written back.
  appCache.invalidateAll();
  imageRequests.clear();
}

/**
 * Start clearing caches whenever the session ends — in this tab or any other.
 * Returns an unsubscribe function.
 */
export function bindCachesToSession(): () => void {
  return subscribeToSessionEnd(clearAllClientCaches);
}

/**
 * Clear when the signed-in account changes.
 *
 * A different user must never see the previous one's cached metadata, so an
 * account switch is treated exactly like a logout. Call with the current user
 * id; the first call establishes the baseline.
 */
let boundUserId: string | null = null;

export function syncCachesToUser(userId: string | null): void {
  if (boundUserId === userId) return;
  // Includes signing out (userId becomes null) and signing straight into a
  // different account without an intervening logout.
  if (boundUserId !== null) clearAllClientCaches();
  boundUserId = userId;
}

/** Test seam: forget which user the caches are bound to. */
export function resetCacheUserBinding(): void {
  boundUserId = null;
}
