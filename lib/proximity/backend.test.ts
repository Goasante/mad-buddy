import { describe, expect, it } from "vitest";
import {
  NEARBY_STALE_AFTER_MS,
  assertPrivacySafeResponse,
  bucketProximity,
  buildSafeNearbyFriends,
  confidenceFromAccuracy,
  downgradeForConfidence,
  haversineMeters,
  nearbyFriendsResponseSchema,
  weakerConfidence,
  type NearbyLocationRow,
  type NearbyProfileRow
} from "@/lib/proximity/backend";

// ---------------------------------------------------------------------------
// assertPrivacySafeResponse — the product's core promise. These tests are the
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
            proximity_level: "nearby",
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
          proximity_level: "nearby",
          glow_strength: 60,
          status_text: "Glowing nearby",
          last_active_estimate: "Active recently",
          is_premium_theme_unlocked: false,
          confidence: "high",
          latitude: 5.55 // stripped by zod, but never trusted to be
        }
      ]
    });

    // zod dropped the key — and the assertion would catch it if it hadn't.
    expect(JSON.stringify(smuggled)).not.toContain("latitude");
    expect(() => assertPrivacySafeResponse(smuggled)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Proximity bucketing and confidence math
// ---------------------------------------------------------------------------

describe("bucketProximity", () => {
  it.each([
    [0, "very_close"],
    [100, "very_close"],
    [101, "nearby"],
    [500, "nearby"],
    [501, "around"],
    [1500, "around"],
    [1501, "far"],
    [50000, "far"]
  ])("%d meters -> %s", (meters, level) => {
    expect(bucketProximity(meters)).toBe(level);
  });
});

describe("downgradeForConfidence", () => {
  it("keeps levels intact at high confidence", () => {
    expect(downgradeForConfidence("very_close", "high")).toBe("very_close");
  });

  it("downgrades very_close to nearby at medium confidence", () => {
    expect(downgradeForConfidence("very_close", "medium")).toBe("nearby");
  });

  it("downgrades close tiers to around at low confidence", () => {
    expect(downgradeForConfidence("very_close", "low")).toBe("around");
    expect(downgradeForConfidence("nearby", "low")).toBe("around");
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
// buildSafeNearbyFriends — Ghost Mode, blocking, staleness enforcement
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
    expect(result[0].proximity_level).toBe("very_close");
    expect(() => assertPrivacySafeResponse({ friends: result })).not.toThrow();
  });

  it("excludes Ghost Mode users entirely — server-enforced, not UI-hidden", () => {
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

  it("downgrades precision when either side's confidence is weak", () => {
    const result = build({
      viewer: { latitude: 5.6037, longitude: -0.187, confidence: "high" },
      friendIds: ["fuzzy"],
      locationByUserId: new Map([["fuzzy", location("fuzzy", { confidence: "low" })]]),
      profileByUserId: new Map([["fuzzy", profile("fuzzy")]])
    });

    // Physically very close, but low confidence must not claim "very_close".
    expect(result[0].proximity_level).toBe("around");
    expect(result[0].confidence).toBe("low");
  });

  it("far friends get zero glow strength", () => {
    const result = build({
      friendIds: ["far"],
      locationByUserId: new Map([["far", location("far", { latitude: 6.7 })]]),
      profileByUserId: new Map([["far", profile("far")]])
    });

    expect(result[0].proximity_level).toBe("far");
    expect(result[0].glow_strength).toBe(0);
  });
});
