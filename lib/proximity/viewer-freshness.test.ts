import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import {
  buildSafeNearbyFriends,
  NEARBY_STALE_AFTER_MS,
  type NearbyLocationRow,
  type NearbyProfileRow
} from "@/lib/proximity/backend";

/**
 * A distance has two ends.
 *
 * The engine hid a Muddy whose signal had gone quiet, but trusted the VIEWER's
 * own coordinate at any age -- so a fix from yesterday still produced confident
 * bands. Both ends are now held to the same rule.
 */

const NOW = Date.UTC(2026, 7, 15, 20, 0, 0);
const MINUTE = 60 * 1000;
const SAME_PLACE = { latitude: 5.6037, longitude: -0.187 };

const at = (ageMs: number): string => new Date(NOW - ageMs).toISOString();

const location = (userId: string, ageMs: number): NearbyLocationRow => ({
  user_id: userId,
  ...SAME_PLACE,
  confidence: "high",
  last_updated: at(ageMs)
});

const profile = (userId: string): NearbyProfileRow => ({
  user_id: userId,
  full_name: "Ama",
  username: `ama_${userId}`,
  avatar_url: null,
  visibility_status: "visible"
});

/** One Muddy standing in exactly the same place as the viewer. */
function build(viewerAgeMs: number, muddyAgeMs: number) {
  return buildSafeNearbyFriends({
    viewer: location("viewer", viewerAgeMs),
    friendIds: ["muddy"],
    blockedIds: new Set(),
    premiumUserIds: new Set(),
    locationByUserId: new Map([["muddy", location("muddy", muddyAgeMs)]]),
    profileByUserId: new Map([["muddy", profile("muddy")]]),
    now: NOW
  });
}

describe("the 24-hour stale viewer, reproduced exactly", () => {
  /* THE PROVEN FAILURE. A probe against the old engine returned
   * proximity_band: "right_here" for a viewer whose last fix was a day old --
   * a confident claim about this moment, built on yesterday's position. */
  const DAY = 24 * 60 * MINUTE;
  const result = build(DAY, MINUTE);

  it("no longer says right here", () => {
    expect(result.map((friend) => friend.proximity_band)).not.toContain("right_here");
  });

  it("makes no positive Glow claim", () => {
    for (const friend of result) {
      expect(friend.glow_strength).toBe(0);
    }
  });

  it("surfaces nobody as currently nearby", () => {
    // NearbyHero renders what this returns, so an empty result is what keeps a
    // stale viewer from seeing a payoff the app has not earned.
    expect(result).toEqual([]);
  });
});

describe("freshness is required at both ends", () => {
  it("computes normally when both are current", () => {
    const result = build(MINUTE, MINUTE);
    expect(result).toHaveLength(1);
    expect(result[0].proximity_band).toBe("right_here");
    expect(result[0].glow_strength).toBeGreaterThan(0);
  });

  it("says nothing when only the viewer is stale", () => {
    expect(build(90 * MINUTE, MINUTE)).toEqual([]);
  });

  it("hides a Muddy who has gone quiet, as it always did", () => {
    // The pre-existing protection must not regress.
    const result = build(MINUTE, 90 * MINUTE);
    expect(result).toHaveLength(1);
    expect(result[0].proximity_level).toBe("hidden");
    expect(result[0].proximity_band).toBe("outside_range");
    expect(result[0].glow_strength).toBe(0);
  });

  it("says nothing when both are stale", () => {
    expect(build(90 * MINUTE, 90 * MINUTE)).toEqual([]);
  });
});

describe("the viewer boundary is the canonical one", () => {
  it("accepts a fix exactly at the threshold", () => {
    expect(build(NEARBY_STALE_AFTER_MS, MINUTE)).toHaveLength(1);
  });

  it("rejects a fix one millisecond past it", () => {
    expect(build(NEARBY_STALE_AFTER_MS + 1, MINUTE)).toEqual([]);
  });

  it("uses the same rule it applies to a Muddy", () => {
    /* Not "a number that happens to match" -- the viewer guard and the friend
     * guard read the same constant, so one cannot be relaxed alone. */
    const source = stripComments(readFileSync("lib/proximity/backend.ts", "utf8"));
    expect(source).toContain("isLocationFreshForProximity(Date.parse(input.viewer.last_updated)");
    expect(source).not.toMatch(/viewer[\s\S]{0,200}30 \* 60 \* 1000/);
  });

  it("treats a clock-skewed viewer fix as usable rather than silencing them", () => {
    // A server slightly ahead of the device must not blank somebody's Nearby.
    expect(build(-5_000, MINUTE)).toHaveLength(1);
  });
});

describe("the absence tells other people nothing", () => {
  const result = build(24 * 60 * MINUTE, MINUTE);

  it("is indistinguishable from having nobody nearby", () => {
    /* A stale viewer disappears from their OWN nearby list only. Nobody else
     * learns that this person's location went quiet, because the empty result
     * is byte-identical to a quiet evening. */
    const noMuddies = buildSafeNearbyFriends({
      viewer: location("viewer", MINUTE),
      friendIds: [],
      blockedIds: new Set(),
      premiumUserIds: new Set(),
      locationByUserId: new Map(),
      profileByUserId: new Map(),
      now: NOW
    });
    expect(result).toEqual(noMuddies);
  });

  it("emits no reason, timestamp or age", () => {
    // Not even a "why" field: a reason code is a leak with a friendly name.
    expect(JSON.stringify(result)).not.toMatch(/last_updated|reason|stale|age/i);
  });
});

describe("every caller reaches the guard", () => {
  it("keeps the check in the shared filter, not in each caller", () => {
    /* Five call sites funnel through buildSafeNearbyFriends. Guarding them
     * individually would leave five places to forget -- and one of them,
     * socialize-mobile, had already cast the timestamp away. */
    const backend = stripComments(readFileSync("lib/proximity/backend.ts", "utf8"));
    const guardAt = backend.indexOf("isLocationFreshForProximity");
    const distanceAt = backend.indexOf("haversineMeters(input.viewer");
    expect(guardAt).toBeGreaterThan(-1);
    // The guard must precede any distance arithmetic.
    expect(guardAt).toBeLessThan(distanceAt);
  });

  it("requires the timestamp in the type, so no caller can omit it", () => {
    const backend = readFileSync("lib/proximity/backend.ts", "utf8");
    expect(backend).toContain('"latitude" | "longitude" | "confidence" | "last_updated"');
  });

  it("selects the column everywhere a viewer row is read", () => {
    // socialize-mobile never selected it, so it could not have been checked.
    const mobile = readFileSync("lib/social/socialize-mobile.ts", "utf8");
    expect(mobile).toContain('.select("latitude, longitude, confidence, last_updated")');
  });
});
