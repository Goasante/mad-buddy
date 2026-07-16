import "server-only";

import { z } from "zod";
import type { ConfidenceLevel, ProximityLevel } from "@/lib/proximity";

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
  proximity_level: z.enum(["very_close", "nearby", "around", "far", "hidden"]),
  glow_strength: z.number().int().min(0).max(100),
  status_text: z.string(),
  last_active_estimate: z.string(),
  is_premium_theme_unlocked: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  // Muddy Status (feature spec batch 1) — availability/activity context,
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

export function bucketProximity(distanceMeters: number): ProximityLevel {
  if (distanceMeters <= 100) {
    return "very_close";
  }

  if (distanceMeters <= 500) {
    return "nearby";
  }

  if (distanceMeters <= 1500) {
    return "around";
  }

  return "far";
}

export function downgradeForConfidence(level: ProximityLevel, confidence: ConfidenceLevel): ProximityLevel {
  if (confidence === "high") {
    return level;
  }

  if (confidence === "medium" && level === "very_close") {
    return "nearby";
  }

  if (confidence === "low") {
    if (level === "very_close" || level === "nearby") {
      return "around";
    }
  }

  return level;
}

export function glowStrengthForLevel(level: ProximityLevel) {
  const baseByLevel: Record<ProximityLevel, number> = {
    very_close: 90,
    nearby: 64,
    around: 34,
    far: 0,
    hidden: 0
  };

  if (level === "far" || level === "hidden") {
    return 0;
  }

  const jitter = Math.floor(Math.random() * 11) - 5;
  return Math.max(0, Math.min(100, baseByLevel[level] + jitter));
}

export function statusTextFor(level: ProximityLevel, confidence: ConfidenceLevel) {
  if (level === "hidden") {
    return "Hidden right now";
  }

  if (level === "far") {
    return "Not glowing right now";
  }

  if (confidence === "low") {
    return "Location signal is weak";
  }

  if (confidence === "medium") {
    return "Glow confidence is medium";
  }

  if (level === "very_close") {
    return "Very close and glowing clearly";
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

export const NEARBY_STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * Core privacy filter for the nearby-friends response, extracted from the
 * route handler verbatim so it can be unit tested (audit I-09). Enforces:
 * blocked users (either direction) never appear; Ghost Mode users never
 * appear; users without a location or profile never appear; stale signals
 * degrade to "hidden" with zero glow; coordinates never leave this function.
 */
export type MuddyStatusSummary = {
  availability_type: string;
  activity_type: string | null;
  custom_text: string | null;
  expires_at: string;
};

export function buildSafeNearbyFriends(input: {
  viewer: Pick<NearbyLocationRow, "latitude" | "longitude" | "confidence">;
  friendIds: string[];
  blockedIds: ReadonlySet<string>;
  premiumUserIds: ReadonlySet<string>;
  locationByUserId: ReadonlyMap<string, NearbyLocationRow>;
  profileByUserId: ReadonlyMap<string, NearbyProfileRow>;
  statusByUserId?: ReadonlyMap<string, MuddyStatusSummary>;
  now?: number;
}): SafeNearbyFriend[] {
  const now = input.now ?? Date.now();
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

  return input.friendIds.flatMap((friendId) => {
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
          glow_strength: 0,
          status_text: "Last seen a while ago",
          last_active_estimate: "Last seen a while ago",
          is_premium_theme_unlocked: input.premiumUserIds.has(friendId),
          confidence: "low" as const,
          ...statusFor(friendId)
        }
      ];
    }

    const pairConfidence = weakerConfidence(input.viewer.confidence, location.confidence);
    const rawLevel = bucketProximity(haversineMeters(input.viewer, location));
    const proximityLevel = downgradeForConfidence(rawLevel, pairConfidence);
    const glowStrength = glowStrengthForLevel(proximityLevel);

    return [
      {
        friend_id: friendId,
        display_name: profile.full_name,
        username: profile.username,
        avatar_url: profile.avatar_url,
        proximity_level: proximityLevel,
        glow_strength: glowStrength,
        status_text: statusTextFor(proximityLevel, pairConfidence),
        last_active_estimate: lastActiveEstimate(location.last_updated),
        is_premium_theme_unlocked: input.premiumUserIds.has(friendId),
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
