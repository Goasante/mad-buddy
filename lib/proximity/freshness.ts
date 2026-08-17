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

/**
 * TWO DIFFERENT QUESTIONS ABOUT ONE TIMESTAMP.
 *
 * `user_locations.last_updated` answers both, and conflating them let Home make
 * a claim it could not support. They are separated here, next to the proximity
 * rule that owns the second one, so no surface has to invent its own number.
 */

/**
 * How long a fix stays as EVIDENCE THAT LOCATION WAS EVER SET UP.
 *
 * Not a proximity input -- it answers "has this person granted location and had
 * it work?", so first-time permission education is not replayed at somebody who
 * finished it this morning. Long, because the question is about setup history.
 * A permission revoked in system settings stops producing fixes, so this
 * eventually lapses on its own rather than trusting a stored intention.
 */
export const LOCATION_SETUP_EVIDENCE_MS = 6 * 60 * 60 * 1000;

/**
 * Whether a fix proves location has been configured and is working.
 *
 * Deliberately NOT sufficient to claim who is nearby -- see
 * `isLocationFreshForProximity`.
 */
export function hasLocationSetupEvidence(lastFixMs: number | null, nowMs: number): boolean {
  if (lastFixMs === null || !Number.isFinite(lastFixMs)) return false;
  // Clock skew counts as recent, matching getFreshnessState above.
  return nowMs - lastFixMs < LOCATION_SETUP_EVIDENCE_MS;
}

/**
 * Whether a fix is current enough to make a CLAIM ABOUT WHO IS NEARBY.
 *
 * Bound to the canonical proximity rule (`NEARBY_STALE_AFTER_MS`, 30 minutes) --
 * the same threshold that hides a Muddy whose own signal has gone quiet. The
 * viewer is held to the standard their Muddies are held to, because a distance
 * needs BOTH ends to be current: an hour-old position of your own can put
 * somebody standing next to you outside range, or somebody long gone right here.
 */
export function isLocationFreshForProximity(lastFixMs: number | null, nowMs: number): boolean {
  if (lastFixMs === null || !Number.isFinite(lastFixMs)) return false;
  return nowMs - lastFixMs <= PROXIMITY_FRESH_MS;
}

/**
 * Imported rather than redeclared so the two can never drift apart.
 *
 * `backend.ts` imports this module, so the constant lives here and is re-exported
 * there under its established name -- a circular import would be the cost of
 * putting it the other way round.
 */
export const PROXIMITY_FRESH_MS = 30 * 60 * 1000;
