import { describe, expect, it } from "vitest";
import {
  NEARBY_STALE_AFTER_MS,
  CLOSE_MAX_METERS,
  NEAR_MAX_METERS,
  FAR_MAX_METERS,
  MAX_NEARBY_METERS,
  assertPrivacySafeResponse,
  bucketProximity,
  bucketProximityWithConfidence,
  buildSafeNearbyFriends,
  confidenceFromAccuracy,
  haversineMeters,
  nearbyFriendsResponseSchema,
  weakerConfidence,
  type NearbyLocationRow,
  type NearbyProfileRow
} from "@/lib/proximity/backend";

// ---------------------------------------------------------------------------
// assertPrivacySafeResponse, the product's core promise. These tests are the
// regression guard the audit (I-09) said was missing: if anyone ever adds a
// coordinate-bearing field to a nearby response, this suite goes red.
// ---------------------------------------------------------------------------

describe("assertPrivacySafeResponse", () => {
  it("accepts a well-formed safe response", () => {
    expect(() =>
      assertPrivacySafeResponse({
        friends: [
          {
            friend_id: "f",
            display_name: "Ama",
            proximity_level: "near",
            glow_strength: 60,
            confidence: "high"
          }
        ]
      })
    ).not.toThrow();
  });

  it.each([
    ["latitude", { latitude: 5.6 }],
    ["longitude", { longitude: -0.18 }],
    ["lat", { lat: 5.6 }],
    ["lng", { lng: -0.18 }],
    ["coordinates", { coordinates: [5.6, -0.18] }],
    ["distance", { distance: 120 }],
    ["distanceMeters", { distanceMeters: 120 }],
    ["geohash", { geohash: "kpb2" }],
    ["accuracy", { accuracy: 12 }],
    ["radius", { radius: 100 }]
  ])("throws when a %s key appears at the top level", (_label, payload) => {
    expect(() => assertPrivacySafeResponse(payload)).toThrow(/Unsafe location-adjacent/);
  });

  it("throws when a forbidden key is nested deep inside arrays and objects", () => {
    expect(() =>
      assertPrivacySafeResponse({
        friends: [{ profile: { meta: [{ latitude: 5.55 }] } }]
      })
    ).toThrow(/latitude/);
  });

  it("documents why the runtime assertion exists: zod parse alone strips, not rejects, unknown keys", () => {
    const smuggled = nearbyFriendsResponseSchema.parse({
      friends: [
        {
          friend_id: "3f8a2b9c-0d1e-4f5a-8b7c-6d5e4f3a2b1c",
          display_name: "Ama",
          username: "ama",
          avatar_url: null,
          proximity_level: "near",
          proximity_band: "nearby",
          glow_strength: 60,
          status_text: "Glowing nearby",
          last_active_estimate: "Active recently",
          freshness_state: "live",
          is_premium_theme_unlocked: false,
          membership_tier: "free" as const,
          confidence: "high",
          muddy_availability: null,
          muddy_activity: null,
          muddy_status_note: null,
          latitude: 5.55 // stripped by zod, but never trusted to be
        }
      ]
    });

    // zod dropped the key, and the assertion would catch it if it hadn't.
    expect(JSON.stringify(smuggled)).not.toContain("latitude");
    expect(() => assertPrivacySafeResponse(smuggled)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Proximity bucketing and confidence math
// ---------------------------------------------------------------------------

describe("bucketProximity", () => {
  it.each([
    [0, "close"],
    [4_990, "close"],
    [CLOSE_MAX_METERS, "close"], // 5.00km -> Close
    [CLOSE_MAX_METERS + 10, "near"], // 5.01km -> Near
    [9_990, "near"],
    [NEAR_MAX_METERS, "near"], // 10.00km -> Near
    [NEAR_MAX_METERS + 10, "far"], // 10.01km -> Far
    [14_990, "far"],
    [FAR_MAX_METERS, "far"], // 15.00km -> Far
    [FAR_MAX_METERS + 10, null], // 15.01km -> outside nearby range
    [MAX_NEARBY_METERS + 10, null]
  ])("%d meters -> %s", (meters, level) => {
    expect(bucketProximity(meters)).toBe(level);
  });
});

// Exact boundary values from the product spec, expressed in km -> meters, so
// the mapping to the canonical 5/10/15km bands is traceable one to one.
describe("bucketProximity: canonical km boundaries", () => {
  it.each([
    [0, "close"],
    [4.99, "close"],
    [5.0, "close"],
    [5.01, "near"],
    [9.99, "near"],
    [10.0, "near"],
    [10.01, "far"],
    [14.99, "far"],
    [15.0, "far"],
    [15.01, null]
  ])("%skm -> %s", (km, level) => {
    expect(bucketProximity(km * 1000)).toBe(level);
  });
});

describe("bucketProximityWithConfidence", () => {
  it.each(["high", "medium", "low"] as const)(
    "keeps two readings at the same place close with %s confidence",
    (confidence) => {
      expect(bucketProximityWithConfidence(0, confidence)).toBe("close");
    }
  );

  it("only moves a medium-confidence reading outward near a boundary", () => {
    // medium margin is 200m: 4_700+200=4_900 stays Close, 4_900+200=5_100 tips to Near.
    expect(bucketProximityWithConfidence(4_700, "medium")).toBe("close");
    expect(bucketProximityWithConfidence(4_900, "medium")).toBe("near");
  });

  it("uses a wider safety margin for a weak signal, never promoting into a closer bucket", () => {
    // low margin is 2_000m: verify it pushes readings outward at each boundary.
    expect(bucketProximityWithConfidence(2_900, "low")).toBe("close"); // 4_900 -> Close
    expect(bucketProximityWithConfidence(3_100, "low")).toBe("near"); // 5_100 -> Near
    expect(bucketProximityWithConfidence(7_900, "low")).toBe("near"); // 9_900 -> Near
    expect(bucketProximityWithConfidence(8_100, "low")).toBe("far"); // 10_100 -> Far
    expect(bucketProximityWithConfidence(12_900, "low")).toBe("far"); // 14_900 -> Far
    expect(bucketProximityWithConfidence(13_100, "low")).toBe(null); // 15_100 -> outside range
  });
});

describe("confidenceFromAccuracy", () => {
  it.each([
    [50, "high"],
    [100, "high"],
    [101, "medium"],
    [500, "medium"],
    [501, "low"],
    [Number.NaN, "low"],
    [-1, "low"],
    [10001, "low"]
  ])("accuracy %s -> %s", (accuracy, level) => {
    expect(confidenceFromAccuracy(accuracy as number)).toBe(level);
  });
});

describe("weakerConfidence", () => {
  it("always returns the weaker of the pair", () => {
    expect(weakerConfidence("high", "low")).toBe("low");
    expect(weakerConfidence("medium", "high")).toBe("medium");
    expect(weakerConfidence("high", "high")).toBe("high");
  });
});

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    const p = { latitude: 5.6037, longitude: -0.187 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it("is roughly 111km per degree of latitude", () => {
    const meters = haversineMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 }
    );
    expect(meters).toBeGreaterThan(110_000);
    expect(meters).toBeLessThan(112_000);
  });
});

// ---------------------------------------------------------------------------
// buildSafeNearbyFriends, Ghost Mode, blocking, staleness enforcement
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-07-16T12:00:00.000Z");

function location(userId: string, overrides: Partial<NearbyLocationRow> = {}): NearbyLocationRow {
  return {
    user_id: userId,
    latitude: 5.6037,
    longitude: -0.187,
    confidence: "high",
    last_updated: new Date(NOW - 60_000).toISOString(),
    ...overrides
  };
}

function profile(userId: string, overrides: Partial<NearbyProfileRow> = {}): NearbyProfileRow {
  return {
    user_id: userId,
    full_name: "Test Muddy",
    username: `muddy_${userId}`,
    avatar_url: null,
    visibility_status: "visible",
    ...overrides
  };
}

function build(input: Partial<Parameters<typeof buildSafeNearbyFriends>[0]> = {}) {
  return buildSafeNearbyFriends({
    viewer: { latitude: 5.6037, longitude: -0.187, confidence: "high" },
    friendIds: [],
    blockedIds: new Set(),
    premiumUserIds: new Set(),
    locationByUserId: new Map(),
    profileByUserId: new Map(),
    now: NOW,
    ...input
  });
}

describe("buildSafeNearbyFriends", () => {
  it("returns a visible nearby friend with a bucketed level and no coordinates", () => {
    const result = build({
      friendIds: ["a"],
      locationByUserId: new Map([["a", location("a")]]),
      profileByUserId: new Map([["a", profile("a")]])
    });

    expect(result).toHaveLength(1);
    expect(result[0].proximity_level).toBe("close");
    expect(() => assertPrivacySafeResponse({ friends: result })).not.toThrow();
  });

  it("excludes Ghost Mode users entirely, server-enforced, not UI-hidden", () => {
    const result = build({
      friendIds: ["ghost"],
      locationByUserId: new Map([["ghost", location("ghost")]]),
      profileByUserId: new Map([["ghost", profile("ghost", { visibility_status: "ghost" })]])
    });

    expect(result).toHaveLength(0);
  });

  it("excludes blocked users in either direction", () => {
    const result = build({
      friendIds: ["blocked"],
      blockedIds: new Set(["blocked"]),
      locationByUserId: new Map([["blocked", location("blocked")]]),
      profileByUserId: new Map([["blocked", profile("blocked")]])
    });

    expect(result).toHaveLength(0);
  });

  it("excludes friends without a stored location or profile", () => {
    expect(
      build({
        friendIds: ["no-location"],
        profileByUserId: new Map([["no-location", profile("no-location")]])
      })
    ).toHaveLength(0);

    expect(
      build({
        friendIds: ["no-profile"],
        locationByUserId: new Map([["no-profile", location("no-profile")]])
      })
    ).toHaveLength(0);
  });

  it("degrades stale signals to hidden with zero glow instead of guessing", () => {
    const stale = location("stale", {
      last_updated: new Date(NOW - NEARBY_STALE_AFTER_MS - 1000).toISOString()
    });
    const result = build({
      friendIds: ["stale"],
      locationByUserId: new Map([["stale", stale]]),
      profileByUserId: new Map([["stale", profile("stale")]])
    });

    expect(result).toHaveLength(1);
    expect(result[0].proximity_level).toBe("hidden");
    expect(result[0].glow_strength).toBe(0);
  });

  it("keeps same-place readings very close while preserving weak confidence", () => {
    const result = build({
      viewer: { latitude: 5.6037, longitude: -0.187, confidence: "high" },
      friendIds: ["fuzzy"],
      locationByUserId: new Map([["fuzzy", location("fuzzy", { confidence: "low" })]]),
      profileByUserId: new Map([["fuzzy", profile("fuzzy")]])
    });

    expect(result[0].proximity_level).toBe("close");
    expect(result[0].confidence).toBe("low");
    // THE PRECISION GATE, end to end. These two are at effectively the same
    // spot, but the reading is weak -- so it may not claim "Right here". A
    // band hardcoded to high confidence, or one that ignored the pair
    // confidence entirely, would publish the tightest label here.
    expect(result[0].proximity_band).toBe("close_by");
  });

  it("lets a confident same-place reading say Right here", () => {
    // The other half of the gate: precision is allowed when it is earned.
    const result = build({
      viewer: { latitude: 5.6037, longitude: -0.187, confidence: "high" },
      friendIds: ["sharp"],
      locationByUserId: new Map([["sharp", location("sharp", { confidence: "high" })]]),
      profileByUserId: new Map([["sharp", profile("sharp")]])
    });

    expect(result[0].proximity_band).toBe("right_here");
  });

  it("takes the weaker of the two readings, never the viewer's alone", () => {
    // A confident viewer must not make someone else's soft fix look precise.
    const result = build({
      viewer: { latitude: 5.6037, longitude: -0.187, confidence: "high" },
      friendIds: ["soft"],
      locationByUserId: new Map([["soft", location("soft", { confidence: "medium" })]]),
      profileByUserId: new Map([["soft", profile("soft")]])
    });

    expect(result[0].proximity_band).toBe("around_you");
  });

  it("attaches an active Muddy Status and passes the privacy assertion", () => {
    const result = build({
      friendIds: ["a"],
      locationByUserId: new Map([["a", location("a")]]),
      profileByUserId: new Map([["a", profile("a")]]),
      statusByUserId: new Map([
        [
          "a",
          {
            availability_type: "open_to_hang_out",
            activity_type: "studying",
            custom_text: "At the library until 6",
            expires_at: new Date(NOW + 60 * 60 * 1000).toISOString()
          }
        ]
      ])
    });

    expect(result[0].muddy_availability).toBe("open_to_hang_out");
    expect(result[0].muddy_activity).toBe("studying");
    expect(result[0].muddy_status_note).toBe("At the library until 6");
    expect(() => assertPrivacySafeResponse({ friends: result })).not.toThrow();
  });

  it("never surfaces an expired status", () => {
    const result = build({
      friendIds: ["a"],
      locationByUserId: new Map([["a", location("a")]]),
      profileByUserId: new Map([["a", profile("a")]]),
      statusByUserId: new Map([
        [
          "a",
          {
            availability_type: "free",
            activity_type: null,
            custom_text: null,
            expires_at: new Date(NOW - 1000).toISOString()
          }
        ]
      ])
    });

    expect(result[0].muddy_availability).toBeNull();
    expect(result[0].muddy_status_note).toBeNull();
  });

  it("far friends (10-15km) get a subtle but non-zero glow", () => {
    // ~0.1 degree of latitude is ~11.1km, inside the Far band (>10-15km).
    const result = build({
      friendIds: ["far"],
      locationByUserId: new Map([["far", location("far", { latitude: 5.6037 + 0.1 })]]),
      profileByUserId: new Map([["far", profile("far")]])
    });

    expect(result[0].proximity_level).toBe("far");
    expect(result[0].glow_strength).toBeGreaterThan(0);
  });

  it("excludes friends beyond the 15km nearby range entirely, not just muted", () => {
    // ~1 degree of latitude is ~111km, far outside MAX_NEARBY_METERS.
    const result = build({
      friendIds: ["outside-range"],
      locationByUserId: new Map([["outside-range", location("outside-range", { latitude: 6.7 })]]),
      profileByUserId: new Map([["outside-range", profile("outside-range")]])
    });

    expect(result).toHaveLength(0);
  });

  it("premium glow color entitlement does not affect the proximity bucket", () => {
    const withoutPremium = build({
      friendIds: ["a"],
      locationByUserId: new Map([["a", location("a")]]),
      profileByUserId: new Map([["a", profile("a")]]),
      premiumUserIds: new Set()
    });
    const withPremium = build({
      friendIds: ["a"],
      locationByUserId: new Map([["a", location("a")]]),
      profileByUserId: new Map([["a", profile("a")]]),
      premiumUserIds: new Set(["a"])
    });

    expect(withoutPremium[0].proximity_level).toBe(withPremium[0].proximity_level);
    // glow_strength includes +/-5 random jitter, so compare the base range
    // rather than exact equality between two independent calls.
    expect(withoutPremium[0].glow_strength).toBeGreaterThanOrEqual(85);
    expect(withPremium[0].glow_strength).toBeGreaterThanOrEqual(85);
    expect(withPremium[0].is_premium_theme_unlocked).toBe(true);
    expect(withoutPremium[0].is_premium_theme_unlocked).toBe(false);
  });
});
