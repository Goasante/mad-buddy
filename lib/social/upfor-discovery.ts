import "server-only";

import { AREA_TIER_PROXIMITY, type SocializeAreaTier } from "@/lib/social/socialize";
import { FRESHNESS_OLDER_MS } from "@/lib/proximity/freshness";
import type { ProximityLevel } from "@/lib/proximity";

/**
 * UpFor proximity — server-only derivation and gating.
 *
 * Two jobs, both of which must never happen on the client:
 *
 *   1. Turn a pair of coordinates into a coarse tier at creation time.
 *   2. Decide, per viewer, whether an opted-in UpFor may be shown at all.
 *
 * Coordinates enter this module and never leave it. Everything returned is a
 * band name or a boolean.
 */

/**
 * How old a location may be and still support a proximity claim.
 *
 * Reuses the existing freshness model's outer band rather than inventing a
 * window: 15 minutes is already the point at which the product stops treating
 * a position as current. Past it, an UpFor keeps whatever area text its
 * creator typed but stops claiming a tier — text is a statement about a place,
 * a tier is a claim about right now.
 */
export const UPFOR_LOCATION_MAX_AGE_MS = FRESHNESS_OLDER_MS;

export function isLocationFreshEnough(lastUpdatedIso: string | null, nowMs: number): boolean {
  if (!lastUpdatedIso) return false;
  const updated = Date.parse(lastUpdatedIso);
  if (!Number.isFinite(updated)) return false;
  // A future timestamp is clock skew, not freshness. Treated as current
  // rather than trusted for precision, matching getFreshnessState.
  return nowMs - updated <= UPFOR_LOCATION_MAX_AGE_MS;
}

/**
 * The coarse band a proximity level falls into.
 *
 * Inverts the existing AREA_TIER_PROXIMITY map rather than restating its
 * thresholds, so the two can never drift: whatever Linkr considers "close"
 * is what UpFor calls `close_by`.
 */
export function tierForProximityLevel(level: ProximityLevel): SocializeAreaTier | null {
  if (AREA_TIER_PROXIMITY.close_by.includes(level)) return "close_by";
  if (AREA_TIER_PROXIMITY.nearby.includes(level)) return "nearby";
  if (AREA_TIER_PROXIMITY.wider_area.includes(level)) return "wider_area";
  // "hidden" and anything unrecognised: no claim.
  return null;
}

/**
 * Every gate a stranger must clear before an opted-in UpFor is shown.
 *
 * Written as one pure function so the rules are visible in one place and
 * testable without a database. Order does not matter — all must pass — but
 * each is listed explicitly rather than collapsed into a single boolean, so a
 * future reader can see exactly which protections exist.
 *
 * FAIL-CLOSED: every unknown is a refusal. A missing location, an
 * unparseable timestamp, an absent proximity level — all deny. The only way
 * through is for every condition to be affirmatively true.
 *
 * Being geographically near is NOT one of the gates on its own. It is the
 * last of several, and it can never substitute for the others.
 */
export type StrangerDiscoveryInput = {
  /** The creator's explicit choice. Anything but "nearby" denies. */
  discoveryScope: string;
  sessionStatus: string;
  endsAt: string;
  /** Freshness of the CREATOR's location, at derivation time. */
  creatorLocationUpdatedAt: string | null;
  /** Whether the VIEWER has a usable position of their own. */
  viewerHasLocation: boolean;
  /** Blocks in either direction. */
  blockedEitherWay: boolean;
  /** The creator's profile visibility. Ghost hides them from strangers. */
  creatorVisibilityStatus: string | null;
  /** Any account restriction Linkr already applies to the creator. */
  creatorRestricted: boolean;
  /** The viewer-relative band, computed from both positions. */
  proximityLevel: ProximityLevel | null;
  nowMs: number;
};

export function canStrangerDiscoverUpFor(input: StrangerDiscoveryInput): boolean {
  // 1. The creator opted in. Nothing else matters if they did not.
  if (input.discoveryScope !== "nearby") return false;

  // 2. The session is live.
  if (input.sessionStatus !== "active") return false;
  const endsAt = Date.parse(input.endsAt);
  if (!Number.isFinite(endsAt) || endsAt <= input.nowMs) return false;

  // 3. The creator's position is recent enough to support a claim about now.
  if (!isLocationFreshEnough(input.creatorLocationUpdatedAt, input.nowMs)) return false;

  // 4. The viewer has a position of their own. Without one there is nothing
  //    to compare, and "nearby" would be meaningless.
  if (!input.viewerHasLocation) return false;

  // 5. A block in EITHER direction denies. Proximity never overrides it.
  if (input.blockedEitherWay) return false;

  // 6. Ghost mode hides the creator from people who are not already Muddies.
  if (input.creatorVisibilityStatus === "ghost") return false;

  // 7. Whatever account restrictions Linkr already enforces.
  if (input.creatorRestricted) return false;

  // 8. And only now, proximity. Never on its own.
  const tier = input.proximityLevel ? tierForProximityLevel(input.proximityLevel) : null;
  return tier === "close_by" || tier === "nearby";
}

/**
 * The creator's own coarse band, from their location confidence.
 *
 * This is NOT a distance to any viewer — it describes how precisely we know
 * where the creator is, which is what a session can honestly carry. A high
 * confidence position supports the tightest band; a coarse one only supports
 * the widest.
 *
 * Viewer-relative proximity is computed per request in the discovery path.
 * Storing one viewer's answer on the row would make it universal truth, which
 * it is not: "close by" is a different fact for every person asking.
 */
export function confidenceToAreaTier(confidence: string | null): SocializeAreaTier | null {
  switch (confidence) {
    case "high":
      return "close_by";
    case "medium":
      return "nearby";
    case "low":
      return "wider_area";
    default:
      // Unknown confidence makes no claim.
      return null;
  }
}
