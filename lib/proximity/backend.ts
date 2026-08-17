import "server-only";

import { z } from "zod";
import {
  getFreshnessState,
  isLocationFreshForProximity,
  PROXIMITY_FRESH_MS
} from "@/lib/proximity/freshness";
import type { PublicMembershipTier } from "@/lib/billing/premium-identity";
import type { ConfidenceLevel, ProximityLevel } from "@/lib/proximity";
import { resolveProximityBand } from "@/lib/proximity/bands";

export const locationUpdateRequestSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10000)
});

export const safeNearbyFriendSchema = z.object({
  friend_id: z.string().uuid(),
  display_name: z.string(),
  username: z.string(),
  avatar_url: z.string().nullable(),
  proximity_level: z.enum(["close", "near", "far", "hidden"]),
  // Presentation band: a finer read of the SAME measured distance, capped by
  // the reading's own confidence so a soft fix cannot claim a tight band.
  // An identifier, never a distance.
  proximity_band: z.enum([
    "right_here",
    "around_you",
    "close_by",
    "nearby",
    "around_town",
    "further_away",
    "outside_range"
  ]),
  glow_strength: z.number().int().min(0).max(100),
  status_text: z.string(),
  last_active_estimate: z.string(),
  // Presence Freshness (feature spec batch 4), coarse recency band only,
  // never an exact timestamp or device/permission state.
  freshness_state: z.enum(["live", "recent", "older", "stale"]),
  is_premium_theme_unlocked: z.boolean(),
  // Effective public membership tier, for the identity ring on the avatar.
  // Deliberately three opaque values: paid, trial, earned and admin-granted
  // access all collapse to the same tier, so a viewer cannot tell HOW a
  // Muddy has Plus or Pro, and no provider, status, expiry or reward detail
  // can ride along. Kept alongside is_premium_theme_unlocked rather than
  // replacing it: that boolean gates the custom-glow entitlement, which is a
  // different question from "what tier is this person".
  membership_tier: z.enum(["free", "plus", "pro"]),
  confidence: z.enum(["high", "medium", "low"]),
  // Muddy Status (feature spec batch 1), availability/activity context,
  // never location data. All nullable: absent when no active status.
  muddy_availability: z.string().nullable(),
  muddy_activity: z.string().nullable(),
  muddy_status_note: z.string().nullable()
});

export const nearbyFriendsResponseSchema = z.object({
  friends: z.array(safeNearbyFriendSchema)
});

export type LocationUpdateRequest = z.infer<typeof locationUpdateRequestSchema>;
export type SafeNearbyFriend = z.infer<typeof safeNearbyFriendSchema>;
export type NearbyFriendsResponse = z.infer<typeof nearbyFriendsResponseSchema>;

const confidenceRank: Record<ConfidenceLevel, number> = {
  low: 0,
  medium: 1,
  high: 2
};

const forbiddenResponseKeyPattern =
  /(latitude|longitude|^lat$|^lng$|^lon$|coord|coordinate|distance|meters|geohash|accuracy|radius)/i;

export function confidenceFromAccuracy(accuracy: number): ConfidenceLevel {
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 10000) {
    return "low";
  }

  if (accuracy <= 100) {
    return "high";
  }

  if (accuracy <= 500) {
    return "medium";
  }

  return "low";
}

export function weakerConfidence(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  return confidenceRank[a] <= confidenceRank[b] ? a : b;
}

export function haversineMeters(a: Pick<LocationUpdateRequest, "latitude" | "longitude">, b: Pick<LocationUpdateRequest, "latitude" | "longitude">) {
  const earthRadiusMeters = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLatitude = toRadians(b.latitude - a.latitude);
  const deltaLongitude = toRadians(b.longitude - a.longitude);
  const latitudeA = toRadians(a.latitude);
  const latitudeB = toRadians(b.latitude);
  const sinLatitude = Math.sin(deltaLatitude / 2);
  const sinLongitude = Math.sin(deltaLongitude / 2);
  const centralAngle =
    sinLatitude * sinLatitude +
    Math.cos(latitudeA) * Math.cos(latitudeB) * sinLongitude * sinLongitude;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(centralAngle), Math.sqrt(1 - centralAngle));
}

// Canonical nearby-discovery bands (audit: tightened from the old 25/50/100km
// scale). These are intentionally computed only on the server and never
// returned as distances/meters/km — the client receives the derived label
// only. Anyone beyond MAX_NEARBY_METERS is outside the approved nearby range
// entirely: bucketProximity returns null for them and buildSafeNearbyFriends
// excludes them from the response (see below), not just mutes their glow.
export const CLOSE_MAX_METERS = 5_000;
export const NEAR_MAX_METERS = 10_000;
export const FAR_MAX_METERS = 15_000;
export const MAX_NEARBY_METERS = FAR_MAX_METERS;

export function bucketProximity(distanceMeters: number): "close" | "near" | "far" | null {
  if (distanceMeters <= CLOSE_MAX_METERS) {
    return "close";
  }

  if (distanceMeters <= NEAR_MAX_METERS) {
    return "near";
  }

  if (distanceMeters <= FAR_MAX_METERS) {
    return "far";
  }

  return null;
}

// Rescaled in lockstep with the bands above: a low-confidence margin must
// stay a small fraction of the (now much tighter) range, or every weak-signal
// reading would resolve outward past "far" and vanish from nearby entirely.
const confidenceUncertaintyMeters: Record<ConfidenceLevel, number> = {
  high: 0,
  medium: 200,
  low: 2_000
};

/**
 * Applies uncertainty at a band boundary instead of blindly downgrading the
 * whole band. Two readings at the same place remain Close even when the
 * device reports a soft signal, while a reading close to a boundary resolves
 * outward rather than making an overconfident claim. Never promotes a user
 * into a closer bucket than the measured distance supports.
 */
export function bucketProximityWithConfidence(
  distanceMeters: number,
  confidence: ConfidenceLevel
): "close" | "near" | "far" | null {
  return bucketProximity(distanceMeters + confidenceUncertaintyMeters[confidence]);
}

export function glowStrengthForLevel(level: ProximityLevel) {
  const baseByLevel: Record<ProximityLevel, number> = {
    close: 90,
    near: 64,
    far: 34,
    hidden: 0
  };

  if (level === "hidden") {
    return 0;
  }

  const jitter = Math.floor(Math.random() * 11) - 5;
  return Math.max(0, Math.min(100, baseByLevel[level] + jitter));
}

export function statusTextFor(level: ProximityLevel, confidence: ConfidenceLevel) {
  if (level === "hidden") {
    return "Hidden right now";
  }

  if (confidence === "low") {
    return "Location signal is weak";
  }

  if (confidence === "medium") {
    return "Glow confidence is medium";
  }

  if (level === "close") {
    return "Close and glowing clearly";
  }

  return "Glowing nearby";
}

export function lastActiveEstimate(lastUpdated: string | Date) {
  const updatedAt = typeof lastUpdated === "string" ? new Date(lastUpdated) : lastUpdated;
  const ageMinutes = Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / 60000));

  if (ageMinutes < 5) {
    return "Active recently";
  }

  if (ageMinutes <= 30) {
    return "Updated a few minutes ago";
  }

  return "Last seen a while ago";
}

export type NearbyLocationRow = {
  user_id: string;
  latitude: number;
  longitude: number;
  confidence: ConfidenceLevel;
  last_updated: string;
};

export type NearbyProfileRow = {
  user_id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  visibility_status: "visible" | "ghost" | "app_open_only";
};

/**
 * The canonical proximity freshness rule, kept at its established name.
 *
 * Defined once in `freshness.ts` and re-exported here: activation asks the same
 * question about the viewer's own fix that this asks about a Muddy's, and two
 * literals would eventually disagree.
 */
export const NEARBY_STALE_AFTER_MS = PROXIMITY_FRESH_MS;

/**
 * Core privacy filter for the nearby-friends response, extracted from the
 * route handler verbatim so it can be unit tested (audit I-09). Enforces:
 * blocked users (either direction) never appear; Ghost Mode users never
 * appear; users without a location or profile never appear; stale signals
 * degrade to "hidden" with zero glow; friends beyond MAX_NEARBY_METERS
 * (15km) never appear at all; coordinates never leave this function.
 *
 * FRESHNESS IS SYMMETRIC. A distance has two ends, and an old coordinate
 * corrupts it from either one. This checked only the far end: a Muddy who had
 * gone quiet was hidden, but the VIEWER's own position was trusted at any age,
 * so a fix from yesterday still produced confident bands -- reporting somebody
 * "right here" who had long since left, or putting somebody standing next to
 * you outside range. Both ends are now held to the same rule.
 */
export type MuddyStatusSummary = {
  availability_type: string;
  activity_type: string | null;
  custom_text: string | null;
  expires_at: string;
};

export function buildSafeNearbyFriends(input: {
  /**
   * `last_updated` is REQUIRED, and deliberately not optional.
   *
   * It was absent from this type, which made the pure layer structurally
   * incapable of judging its own viewer -- the defect could not have been
   * fixed here without widening it. Optional would have re-opened the hole
   * silently at any call site that forgot; required makes the compiler name
   * every one of them.
   */
  viewer: Pick<NearbyLocationRow, "latitude" | "longitude" | "confidence" | "last_updated">;
  friendIds: string[];
  blockedIds: ReadonlySet<string>;
  premiumUserIds: ReadonlySet<string>;
  /**
   * Effective public tier per friend, resolved server-side by the canonical
   * plan loader. Absent means "free" — never inferred from premiumUserIds,
   * which is a boolean and cannot distinguish plus from pro.
   */
  membershipTierByUserId?: ReadonlyMap<string, PublicMembershipTier>;
  locationByUserId: ReadonlyMap<string, NearbyLocationRow>;
  profileByUserId: ReadonlyMap<string, NearbyProfileRow>;
  statusByUserId?: ReadonlyMap<string, MuddyStatusSummary>;
  now?: number;
}): SafeNearbyFriend[] {
  const now = input.now ?? Date.now();

  /* THE VIEWER'S OWN FIX IS CHECKED FIRST, BEFORE ANY DISTANCE EXISTS.
   *
   * Returning an empty list is the honest answer: with no current position for
   * the viewer, there is no proximity relationship to describe, and every
   * caller already handles "nobody to show". Degrading each Muddy to "hidden"
   * instead would say something subtly false -- that these specific people were
   * evaluated and found unavailable -- when nothing about them was in doubt.
   *
   * This leaks nothing. The absence is identical to having no Muddies nearby,
   * so nobody else can learn that this viewer's location went quiet. The viewer
   * learns it from their own activation state, which is theirs to know. */
  if (!isLocationFreshForProximity(Date.parse(input.viewer.last_updated), now)) {
    return [];
  }

  // Absent tier means free. Never derived from premiumUserIds.
  const tierFor = (friendId: string): PublicMembershipTier =>
    input.membershipTierByUserId?.get(friendId) ?? "free";
  const statusFor = (friendId: string) => {
    const status = input.statusByUserId?.get(friendId);
    // Expired statuses never surface (spec: expired statuses must not
    // remain visible); Ghost/blocked exclusion already happened above this.
    if (!status || Date.parse(status.expires_at) <= now) {
      return { muddy_availability: null, muddy_activity: null, muddy_status_note: null };
    }
    return {
      muddy_availability: status.availability_type,
      muddy_activity: status.activity_type,
      muddy_status_note: status.custom_text
    };
  };

  return input.friendIds.flatMap((friendId): SafeNearbyFriend[] => {
    if (input.blockedIds.has(friendId)) {
      return [];
    }

    const location = input.locationByUserId.get(friendId);
    const profile = input.profileByUserId.get(friendId);

    if (!location || !profile || profile.visibility_status === "ghost") {
      return [];
    }

    const updatedAt = new Date(location.last_updated);
    const isStale = now - updatedAt.getTime() > NEARBY_STALE_AFTER_MS;

    if (isStale) {
      return [
        {
          friend_id: friendId,
          display_name: profile.full_name,
          username: profile.username,
          avatar_url: profile.avatar_url,
          proximity_level: "hidden" as const,
          proximity_band: "outside_range" as const,
          glow_strength: 0,
          status_text: "Last seen a while ago",
          last_active_estimate: "Last seen a while ago",
          freshness_state: "stale" as const,
          is_premium_theme_unlocked: input.premiumUserIds.has(friendId),
          membership_tier: tierFor(friendId),
          confidence: "low" as const,
          ...statusFor(friendId)
        }
      ];
    }

    const pairConfidence = weakerConfidence(input.viewer.confidence, location.confidence);
    const measuredDistance = haversineMeters(input.viewer, location);
    const proximityLevel = bucketProximityWithConfidence(measuredDistance, pairConfidence);

    // Beyond the approved nearby range entirely: excluded from the response,
    // not just muted, so a friend outside 15km never appears in Nearby
    // Muddies / proximity discovery at all.
    if (proximityLevel === null) {
      return [];
    }

    const glowStrength = glowStrengthForLevel(proximityLevel);

    return [
      {
        friend_id: friendId,
        display_name: profile.full_name,
        username: profile.username,
        avatar_url: profile.avatar_url,
        proximity_level: proximityLevel,
        // Same measured distance, same confidence the level already used.
        proximity_band: resolveProximityBand(measuredDistance, pairConfidence),
        glow_strength: glowStrength,
        status_text: statusTextFor(proximityLevel, pairConfidence),
        last_active_estimate: lastActiveEstimate(location.last_updated),
        freshness_state: getFreshnessState(updatedAt.getTime(), now),
        is_premium_theme_unlocked: input.premiumUserIds.has(friendId),
          membership_tier: tierFor(friendId),
        confidence: pairConfidence,
        ...statusFor(friendId)
      }
    ];
  });
}

export function assertPrivacySafeResponse(value: unknown) {
  const visit = (current: unknown) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }

    if (!current || typeof current !== "object") {
      return;
    }

    Object.entries(current).forEach(([key, nestedValue]) => {
      if (forbiddenResponseKeyPattern.test(key)) {
        throw new Error(`Unsafe location-adjacent response key detected: ${key}`);
      }

      visit(nestedValue);
    });
  };

  visit(value);
}
