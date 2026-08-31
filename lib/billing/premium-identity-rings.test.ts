import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectivePlan, type BillingState } from "@/lib/billing/entitlements";
import {
  publicMembershipTier,
  type PublicMembershipTier
} from "@/lib/billing/premium-identity";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const NOW = Date.UTC(2026, 0, 15);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function state(overrides: Partial<BillingState>): BillingState {
  return {
    plan: "free",
    status: "inactive",
    periodEndMs: null,
    graceEndsMs: null,
    ...overrides
  } as BillingState;
}

/** The tier a public surface would show, from raw billing state. */
function tierFor(billing: BillingState, nowMs = NOW): PublicMembershipTier {
  return publicMembershipTier(effectivePlan(billing, nowMs));
}

// ---------------------------------------------------------------------------
// Tier resolution — the ring reflects EFFECTIVE membership, whatever its source
// ---------------------------------------------------------------------------

describe("premium ring tier resolution", () => {
  it("gives free accounts no tier, so they get no ring", () => {
    expect(tierFor(state({}))).toBe("free");
  });

  it("resolves a paid subscription to its own tier", () => {
    expect(tierFor(state({ plan: "buddy_plus", status: "active" }))).toBe("plus");
    expect(tierFor(state({ plan: "buddy_pro", status: "active" }))).toBe("pro");
  });

  it("resolves an active trial to the trial's tier", () => {
    const trialling = state({
      trialId: "trial-1",
      trialPlan: "buddy_pro",
      trialStartedAtMs: NOW - DAY,
      trialEndsAtMs: NOW + DAY
    });
    expect(tierFor(trialling)).toBe("pro");
  });

  it("resolves an active earned reward to the reward's tier", () => {
    const earned = state({
      earnedRewardId: "reward-1",
      earnedPlan: "buddy_plus",
      earnedStartsAtMs: NOW - DAY,
      earnedEndsAtMs: NOW + DAY
    });
    expect(tierFor(earned)).toBe("plus");
  });

  it("treats paid, trial and earned access as indistinguishable once resolved", () => {
    // The whole point: a viewer cannot tell HOW someone got Pro.
    const paid = tierFor(state({ plan: "buddy_pro", status: "active" }));
    const trial = tierFor(
      state({ trialId: "t", trialPlan: "buddy_pro", trialStartedAtMs: NOW - DAY, trialEndsAtMs: NOW + DAY })
    );
    const earned = tierFor(
      state({ earnedRewardId: "r", earnedPlan: "buddy_pro", earnedStartsAtMs: NOW - DAY, earnedEndsAtMs: NOW + DAY })
    );
    expect(new Set([paid, trial, earned])).toEqual(new Set(["pro"]));
  });

  it("removes the ring once access expires", () => {
    const expiredTrial = state({
      trialId: "trial-1",
      trialPlan: "buddy_pro",
      trialStartedAtMs: NOW - 10 * DAY,
      trialEndsAtMs: NOW - DAY
    });
    expect(tierFor(expiredTrial)).toBe("free");

    const expiredEarned = state({
      earnedRewardId: "reward-1",
      earnedPlan: "buddy_plus",
      earnedStartsAtMs: NOW - 10 * DAY,
      earnedEndsAtMs: NOW - DAY
    });
    expect(tierFor(expiredEarned)).toBe("free");

    const lapsedPaid = state({
      plan: "buddy_pro",
      status: "past_due",
      periodEndMs: NOW - DAY,
      graceEndsMs: NOW - HOUR
    });
    expect(tierFor(lapsedPaid)).toBe("free");
  });
});

// ---------------------------------------------------------------------------
// Privacy — the projection carries a tier and nothing else
// ---------------------------------------------------------------------------

describe("premium ring privacy", () => {
  it("exposes only free, plus or pro", () => {
    const tiers = new Set<PublicMembershipTier>();
    for (const plan of ["free", "buddy_plus", "buddy_pro"] as const) {
      tiers.add(publicMembershipTier(plan));
    }
    expect(tiers).toEqual(new Set(["free", "plus", "pro"]));
  });

  it("cannot express how access was obtained", () => {
    // publicMembershipTier takes a plan, not a billing state, so there is no
    // parameter through which a source, provider or date could leak.
    for (const value of ["free", "buddy_plus", "buddy_pro", null, undefined] as const) {
      const tier = publicMembershipTier(value);
      expect(["free", "plus", "pro"]).toContain(tier);
      expect(JSON.stringify(tier)).not.toMatch(/trial|earned|admin|stripe|paystack|renew|override/i);
    }
  });

  it("keeps raw billing vocabulary out of the avatar component", () => {
    const avatar = read("components/ui/user-avatar.tsx");
    for (const forbidden of [
      "periodEnd",
      "graceEnds",
      "trialId",
      "earnedRewardId",
      "paystack",
      "stripe",
      "billingAccessSource"
    ]) {
      expect(avatar, `avatar must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("never infers a tier from a boolean premium flag", () => {
    const avatar = read("components/ui/user-avatar.tsx");
    // A boolean cannot tell plus from pro; using one would mean guessing.
    expect(avatar).not.toContain("isPremium");
    expect(avatar).not.toContain("is_premium_theme_unlocked");
  });
});

// ---------------------------------------------------------------------------
// Presentation — membership never changes avatar geometry
// ---------------------------------------------------------------------------

describe("premium ring presentation", () => {
  const avatar = read("components/ui/user-avatar.tsx");
  const css = read("app/globals.css");

  it("removes membership ring markup, colour and animation", () => {
    expect(avatar).not.toContain("membershipTier");
    expect(avatar).not.toContain("avatar-ring-");
    expect(css).not.toContain(".avatar-ring-plus");
    expect(css).not.toContain(".avatar-ring-pro");
    expect(css).not.toContain("avatar-ring-pro-shimmer");
  });
});

// ---------------------------------------------------------------------------
// Wiring — surfaces derive the tier from a server projection, or show none
// ---------------------------------------------------------------------------

describe("premium ring wiring", () => {
  const activeAvatarSurfaces: Array<[string, string]> = [
    ["own profile", "components/profile/profile-page.tsx"],
    ["public profile", "components/friends/muddy-profile-page.tsx"],
    ["Profile VNext", "components/profile/profile-vnext-page.tsx"],
    ["Profile VNext edit", "components/profile/profile-edit-vnext.tsx"],
    ["Profile VNext public", "components/friends/muddy-profile-vnext.tsx"],
    ["Muddies and requests", "components/friends/friends-page.tsx"],
    ["Muddies grid", "components/friends/muddies-grid.tsx"],
    ["Home proximity", "components/dashboard/dashboard-page.tsx"],
    ["messages", "components/messages/messages-page.tsx"],
    ["messages V2", "components/messages/messages-page-v2.tsx"],
    ["messages V3", "components/messages/messages-page-v3.tsx"],
    ["chat settings", "components/messaging/chat-settings-v4.tsx"],
    ["groups", "components/groups/group-detail-page.tsx"],
    ["events", "components/events/event-detail.tsx"],
    ["event room", "components/events/event-room-detail.tsx"],
    ["moments", "components/content/moment-parts.tsx"],
    ["moment viewer", "components/content/moment-media-viewer.tsx"],
    ["Air", "components/content/tuned-in-strip.tsx"],
    ["contacts", "components/contacts/find-muddies-sheet.tsx"],
    ["Socialize card", "components/socialize/socialize-person-card.tsx"],
    ["Socialize deck", "components/socialize/swipe-deck.tsx"],
    ["Profile lab people", "app/(app)/profile-lab/people/page.tsx"]
  ];

  for (const [surface, path] of activeAvatarSurfaces) {
    it(`keeps membership-ring wiring off ${surface}`, () => {
      const source = read(path);
      expect(source).not.toContain("publicMembershipTier(");
      expect(source).not.toContain("membershipTier=");
    });
  }

  it("keeps the public Profile Glow canonical without a competing membership ring", () => {
    const source = read("components/friends/muddy-profile-page.tsx");
    expect(source).toContain("<ProximityGlowAvatar");
    expect(source).toContain("band={muddy.proximityBand ?? null}");
    expect(source).not.toContain("membershipTier=");
  });

  it("does not load a premium tier solely for the Profile VNext edit avatar", () => {
    const source = read("app/(app)/profile-lab/edit/page.tsx");
    expect(source).not.toContain("loadEffectivePlan");
    expect(source).not.toContain("plan={");
  });

  it("removes membership inputs from shared avatar components", () => {
    for (const path of [
      "components/ui/user-avatar.tsx",
      "components/glow/glow-avatar.tsx",
      "components/glow/proximity-glow-avatar.tsx"
    ]) {
      expect(read(path)).not.toContain("membershipTier");
    }
  });

  it("preserves canonical proximity Glow inputs", () => {
    const avatar = read("components/glow/proximity-glow-avatar.tsx");
    expect(avatar).toContain("band?: ProximityBand | null");
    expect(avatar).toContain("glowColorId?: string | null");
    expect(avatar).toContain("size?: ProximityGlowSize");
    expect(avatar).toContain("level={resolvedLevel}");
    expect(avatar).toContain("glowColorId={glowColorId}");
    expect(avatar).toContain("size={size}");
  });

  it("leaves a blocked viewer with no identity to project", () => {
    // loadPublicProfile returns null when either side has blocked the other,
    // so there is no avatar, name or plan to render a ring from.
    const publicProfile = read("lib/profile/public.ts");
    expect(publicProfile).toContain("A block");
    expect(publicProfile).toContain("returns null");
  });

  it("leaves surfaces without a real tier unringed rather than guessing", () => {
    // Plan attendees and Home Nearby carry no effective tier in their
    // projections yet, so they must not fall back to a generic ring.
    expect(read("lib/social/upcoming-plans.ts")).not.toContain("membershipTier");
    expect(read("lib/plans/service.ts")).not.toContain("membershipTier");
  });
});

// ---------------------------------------------------------------------------
// Billing projections remain compatible even though avatars no longer use them
// ---------------------------------------------------------------------------

describe("membership projection compatibility", () => {
  it("resolves every projected plan through the canonical loaders", () => {
    // Each projection uses loadEffectivePlan(sForUsers), which applies the
    // paid → trial → earned precedence and expiry. None builds its own rule.
    for (const path of [
      "lib/messaging/mobile.ts",
      "lib/content/service.ts",
      "lib/events/service.ts"
    ]) {
      expect(read(path)).toMatch(/loadEffectivePlan(sForUsers)?\(/);
    }
  });

  it("keeps group conversations unringed — there is no single other user", () => {
    const messaging = read("lib/messaging/mobile.ts");
    // otherPlan is null unless the conversation is direct.
    expect(messaging).toContain('conversation.conversation_type === "direct"');
  });

  it("leaves membership out of Socialize ranking and eligibility", () => {
    const socialize = read("lib/social/socialize-mobile.ts");
    // plan is projected for display only; it must not appear in ordering.
    const ordering = socialize.match(/\.sort\([\s\S]{0,200}/g) ?? [];
    for (const block of ordering) {
      expect(block).not.toContain("plan");
    }
  });
});
