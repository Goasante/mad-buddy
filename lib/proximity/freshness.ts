/**
 * Presence Freshness (feature architecture batch 4, spec §43-§55). Pure,
 * server-time-authoritative helpers that tell a viewer how current a proximity
 * result is. Coarse labels only, freshness must never leak another user's
 * exact app-open time, device, or permission state (spec §53).
 */

export type FreshnessState = "live" | "recent" | "older" | "stale";

// Thresholds (spec §44). Live within a minute, recent within 5, older within
// 15; anything beyond is stale. These are viewer-facing bands, deliberately
// coarser than the raw update cadence.
export const FRESHNESS_LIVE_MS = 60 * 1000;
export const FRESHNESS_RECENT_MS = 5 * 60 * 1000;
export const FRESHNESS_OLDER_MS = 15 * 60 * 1000;

/**
 * Classifies a proximity result's age using server timestamps only. A future
 * timestamp (clock skew, spec §52) is treated as live rather than trusted for
 * precision. `nowMs` is injectable for testing and must be a server clock.
 */
export function getFreshnessState(lastUpdatedMs: number, nowMs: number): FreshnessState {
  const ageMs = nowMs - lastUpdatedMs;
  if (ageMs <= FRESHNESS_LIVE_MS) return "live";
  if (ageMs <= FRESHNESS_RECENT_MS) return "recent";
  if (ageMs <= FRESHNESS_OLDER_MS) return "older";
  return "stale";
}

/** Coarse, viewer-facing label. Never exposes an exact timestamp (spec §45). */
export function freshnessLabel(state: FreshnessState): string {
  switch (state) {
    case "live":
      return "Live";
    case "recent":
      return "Updated a few minutes ago";
    case "older":
      return "Updated a while ago";
    case "stale":
      return "Status may be outdated";
  }
}

/**
 * Whether proximity-dependent actions (Wave/Meet from a card) should stay
 * enabled. Stale presence disables proximity-triggered actions but never the
 * relationship-level ones like Message (spec §47).
 */
export function proximityActionsAllowed(state: FreshnessState): boolean {
  return state !== "stale";
}

/**
 * The owner-facing warning when *their own* presence isn't updating (spec §51).
 * Only ever shown to the user about themselves, never about another user.
 */
export function ownerStalePresenceWarning(state: FreshnessState): string | null {
  if (state !== "stale") return null;
  return "Your proximity status isn't updating. Check your location permission.";
}
