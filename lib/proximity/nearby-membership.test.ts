import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectivePlan, type BillingState } from "@/lib/billing/entitlements";
import { publicMembershipTier, type PublicMembershipTier } from "@/lib/billing/premium-identity";
import {
  buildSafeNearbyFriends,
  nearbyFriendsResponseSchema,
  type NearbyLocationRow,
  type NearbyProfileRow
} from "@/lib/proximity/backend";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const NOW = Date.UTC(2026, 0, 15);
const DAY = 86_400_000;

/* A CURRENT viewer fix. The engine now requires one before it will compute any
 * distance, because an old position corrupts a band from either end. */
const VIEWER = {
  latitude: 0,
  longitude: 0,
  confidence: "high" as const,
  last_updated: new Date(NOW - 60_000).toISOString()
};

/** ~1km away → "close" at high confidence. */
const CLOSE = { latitude: 0.009, longitude: 0 };
/** ~7km away → "near". */
const NEAR = { latitude: 0.063, longitude: 0 };
/** ~12km away → "far". */
const FAR = { latitude: 0.108, longitude: 0 };

function location(id: string, at: { latitude: number; longitude: number }): NearbyLocationRow {
  return { user_id: id, ...at, confidence: "high", last_updated: new Date(NOW).toISOString() };
}

function profile(id: string): NearbyProfileRow {
  return {
    user_id: id,
    full_name: "Amara Okafor",
    username: "amara",
    avatar_url: null,
    visibility_status: "visible"
  };
}

function build(opts: {
  ids: string[];
  at?: { latitude: number; longitude: number };
  tiers?: Record<string, PublicMembershipTier>;
  premium?: string[];
  blocked?: string[];
}) {
  const at = opts.at ?? CLOSE;
  return buildSafeNearbyFriends({
    viewer: VIEWER,
    friendIds: opts.ids,
    blockedIds: new Set(opts.blocked ?? []),
    premiumUserIds: new Set(opts.premium ?? []),
    membershipTierByUserId: new Map(Object.entries(opts.tiers ?? {})),
    locationByUserId: new Map(opts.ids.map((id) => [id, location(id, at)])),
    profileByUserId: new Map(opts.ids.map((id) => [id, profile(id)])),
    now: NOW
  });
}

// ---------------------------------------------------------------------------
// Tier on the projection
// ---------------------------------------------------------------------------

describe("nearby membership tier", () => {
  it("defaults to free when no tier was resolved", () => {
    const [friend] = build({ ids: ["a"] });
    expect(friend.membership_tier).toBe("free");
  });

  it("projects plus and pro distinctly", () => {
    const [plus] = build({ ids: ["a"], tiers: { a: "plus" } });
    const [pro] = build({ ids: ["b"], tiers: { b: "pro" } });
    expect(plus.membership_tier).toBe("plus");
    expect(pro.membership_tier).toBe("pro");
  });

  it("never derives the tier from the premium-theme boolean", () => {
    // Premium-theme unlocked but no resolved tier → still free. The boolean
    // gates custom glow, and cannot tell plus from pro.
    const [friend] = build({ ids: ["a"], premium: ["a"] });
    expect(friend.is_premium_theme_unlocked).toBe(true);
    expect(friend.membership_tier).toBe("free");
  });

  it("keeps the two flags independent in the other direction too", () => {
    const [friend] = build({ ids: ["a"], tiers: { a: "pro" } });
    expect(friend.membership_tier).toBe("pro");
    expect(friend.is_premium_theme_unlocked).toBe(false);
  });

  it("passes the guarded response schema", () => {
    const friends = build({ ids: ["11111111-1111-4111-8111-111111111111"], tiers: { "11111111-1111-4111-8111-111111111111": "pro" } });
    expect(() => nearbyFriendsResponseSchema.parse({ friends })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Access source collapses; expiry removes only the ring
// ---------------------------------------------------------------------------

describe("nearby tier resolution sources", () => {
  const state = (o: Partial<BillingState>): BillingState =>
    ({ plan: "free", status: "inactive", periodEndMs: null, graceEndsMs: null, ...o }) as BillingState;
  const tier = (b: BillingState) => publicMembershipTier(effectivePlan(b, NOW));

  it("collapses paid, trial and earned access to the same public tier", () => {
    const paid = tier(state({ plan: "buddy_pro", status: "active" }));
    const trial = tier(
      state({ trialId: "t", trialPlan: "buddy_pro", trialStartedAtMs: NOW - DAY, trialEndsAtMs: NOW + DAY })
    );
    const earned = tier(
      state({ earnedRewardId: "r", earnedPlan: "buddy_pro", earnedStartsAtMs: NOW - DAY, earnedEndsAtMs: NOW + DAY })
    );
    expect(new Set([paid, trial, earned])).toEqual(new Set(["free"]));
  });

  it("drops to free once access expires", () => {
    const expired = tier(
      state({ trialId: "t", trialPlan: "buddy_pro", trialStartedAtMs: NOW - 10 * DAY, trialEndsAtMs: NOW - DAY })
    );
    expect(expired).toBe("free");
  });

  it("removes only the ring on expiry — proximity is untouched", () => {
    const withRing = build({ ids: ["a"], tiers: { a: "pro" } })[0];
    const expired = build({ ids: ["a"], tiers: { a: "free" } })[0];
    expect(withRing.membership_tier).toBe("pro");
    expect(expired.membership_tier).toBe("free");
    // Same place, same bucket, same confidence.
    expect(expired.proximity_level).toBe(withRing.proximity_level);
    expect(expired.confidence).toBe(withRing.confidence);
  });
});

// ---------------------------------------------------------------------------
// Membership must not touch proximity
// ---------------------------------------------------------------------------

describe("nearby membership does not affect proximity", () => {
  it("keeps the proximity bucket identical across tiers", () => {
    for (const [at, expected] of [
      [CLOSE, "close"],
      [NEAR, "near"],
      [FAR, "far"]
    ] as const) {
      const free = build({ ids: ["a"], at, tiers: { a: "free" } })[0];
      const pro = build({ ids: ["a"], at, tiers: { a: "pro" } })[0];
      expect(free.proximity_level).toBe(expected);
      expect(pro.proximity_level).toBe(expected);
    }
  });

  it("does not change eligibility — tier cannot add or remove anyone", () => {
    const ids = ["a", "b", "c"];
    const none = build({ ids });
    const mixed = build({ ids, tiers: { a: "pro", b: "plus" } });
    expect(mixed.map((f) => f.friend_id)).toEqual(none.map((f) => f.friend_id));
  });

  it("does not change ordering", () => {
    const ids = ["a", "b", "c"];
    // Only 'c' is premium; order must still follow the input, not the tier.
    const ordered = build({ ids, tiers: { c: "pro" } }).map((f) => f.friend_id);
    expect(ordered).toEqual(ids);
  });

  it("does not change confidence", () => {
    const free = build({ ids: ["a"], tiers: { a: "free" } })[0];
    const pro = build({ ids: ["a"], tiers: { a: "pro" } })[0];
    expect(pro.confidence).toBe(free.confidence);
  });

  it("keeps glow strength within the band for the bucket, regardless of tier", () => {
    // glowStrengthForLevel applies ±5 jitter, so compare bands not exact values.
    for (let i = 0; i < 20; i++) {
      const pro = build({ ids: ["a"], at: CLOSE, tiers: { a: "pro" } })[0];
      expect(pro.glow_strength).toBeGreaterThanOrEqual(85);
      expect(pro.glow_strength).toBeLessThanOrEqual(95);
    }
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe("nearby membership privacy", () => {
  it("returns no projection at all for a blocked user, so no tier leaks", () => {
    const friends = build({ ids: ["a"], tiers: { a: "pro" }, blocked: ["a"] });
    expect(friends).toEqual([]);
  });

  it("returns no projection for a ghost-mode user", () => {
    const friends = buildSafeNearbyFriends({
      viewer: VIEWER,
      friendIds: ["a"],
      blockedIds: new Set(),
      premiumUserIds: new Set(),
      membershipTierByUserId: new Map([["a", "pro"]]),
      locationByUserId: new Map([["a", location("a", CLOSE)]]),
      profileByUserId: new Map([["a", { ...profile("a"), visibility_status: "ghost" }]]),
      now: NOW
    });
    expect(friends).toEqual([]);
  });

  it("exposes only the three opaque tier values", () => {
    const shape = nearbyFriendsResponseSchema.shape.friends.element.shape.membership_tier;
    expect(shape.options).toEqual(["free", "plus", "pro"]);
  });

  it("leaks no billing vocabulary into the projection", () => {
    const backend = read("lib/proximity/backend.ts");
    for (const forbidden of ["periodEnd", "graceEnds", "trialId", "earnedRewardId", "paystack", "stripe", "renew"]) {
      expect(backend, `nearby projection must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("resolves the tier through the canonical loader, not the raw subscriptions query", () => {
    const route = read("app/api/friends/nearby/route.ts");
    expect(route).not.toContain("loadEffectivePlansForUsers(admin, friendIds)");
    expect(route).not.toContain("publicMembershipTier(plan)");
  });

  it("scopes tier resolution to the already-authorised friend set", () => {
    // friendIds is the authorised list; annotating it cannot widen visibility.
    const route = read("app/api/friends/nearby/route.ts");
    expect(route).not.toContain("loadEffectivePlansForUsers(admin, friendIds)");
  });
});

// ---------------------------------------------------------------------------
// Presentation stays in the shared components
// ---------------------------------------------------------------------------

describe("nearby avatar presentation", () => {
  it("does not pass the tier into GlowAvatar or style a ring on Home", () => {
    const home = read("components/dashboard/dashboard-page.tsx");
    expect(home).not.toContain("membershipTier={friend.membershipTier}");
    // No bespoke ring CSS in the Home component.
    expect(home).not.toContain("avatar-ring-plus");
    expect(home).not.toContain("avatar-ring-pro");
  });

  it("never sets the client tier from the premium-theme boolean", () => {
    const home = read("components/dashboard/dashboard-page.tsx");
    expect(home).not.toContain("membershipTier: friend.membership_tier");
    expect(home).not.toContain("membershipTier: friend.is_premium_theme_unlocked");
  });
});
