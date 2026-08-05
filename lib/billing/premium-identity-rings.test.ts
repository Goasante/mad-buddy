import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectivePlan, type BillingState } from "@/lib/billing/entitlements";
import {
  membershipTierLabel,
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
// Presentation — owned by the component, distinct from proximity Glow
// ---------------------------------------------------------------------------

describe("premium ring presentation", () => {
  const avatar = read("components/ui/user-avatar.tsx");
  const css = read("app/globals.css");

  it("gives free avatars no ring markup at all", () => {
    expect(avatar).toContain('if (membershipTier === "free") return avatar;');
  });

  it("uses indigo for plus and gold for pro", () => {
    expect(avatar).toContain("avatar-ring-plus");
    expect(avatar).toContain("avatar-ring-pro");
    expect(css).toMatch(/\.avatar-ring-plus\s*\{[^}]*#6366f1/);
    expect(css).toMatch(/\.avatar-ring-pro\s*\{[^}]*#f59e0b/);
  });

  it("disables the pro shimmer under reduced motion", () => {
    const block = css.slice(css.indexOf(".avatar-ring-pro-animated::after"));
    expect(block).toContain("prefers-reduced-motion: reduce");
    const reduced = block.slice(block.indexOf("prefers-reduced-motion: reduce"));
    expect(reduced).toContain("animation: none");
  });

  it("does not let screens pass arbitrary ring colours", () => {
    // The only membership input is a tier union; there is no colour prop.
    expect(avatar).toContain("membershipTier?: PublicMembershipTier");
    expect(avatar).not.toContain("ringColor");
    expect(avatar).not.toContain("ringClassName");
  });

  it("keeps the premium ring independent of proximity Glow", () => {
    // GlowRing owns proximity; UserAvatar owns membership. Neither reads the
    // other's inputs, so a bright ring can never imply closeness.
    expect(avatar).not.toContain("proximityLevel");
    expect(avatar).not.toContain("glowStrength");
    const glow = read("components/glow/glow-ring.tsx");
    expect(glow).not.toContain("membershipTier");
  });

  it("states membership as text, not colour alone", () => {
    expect(avatar).toContain("sr-only");
    expect(membershipTierLabel("plus")).toBe("Buddy Plus member");
    expect(membershipTierLabel("pro")).toBe("Buddy Pro member");
    expect(membershipTierLabel("free")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wiring — surfaces derive the tier from a server projection, or show none
// ---------------------------------------------------------------------------

describe("premium ring wiring", () => {
  const wired: Array<[string, string]> = [
    ["own profile", "components/profile/profile-page.tsx"],
    ["public profile", "components/friends/muddy-profile-page.tsx"],
    ["muddies list and requests", "components/friends/friends-page.tsx"]
  ];

  for (const [surface, path] of wired) {
    it(`derives the tier from a server-resolved plan on ${surface}`, () => {
      const source = read(path);
      expect(source).toContain("publicMembershipTier(");
      expect(source).toContain("membershipTier={");
    });
  }

  it("passes the tier through GlowAvatar without mixing it into proximity", () => {
    const glowAvatar = read("components/glow/glow-avatar.tsx");
    expect(glowAvatar).toContain("membershipTier");
    // The tier reaches UserAvatar; it must never be fed to GlowRing, whose
    // props are entirely about distance.
    const glowRingCall = glowAvatar.slice(glowAvatar.indexOf("<GlowRing"), glowAvatar.indexOf("<UserAvatar"));
    expect(glowRingCall).not.toContain("membershipTier");
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
// Stage 3 — the remaining authorised identity surfaces
// ---------------------------------------------------------------------------

describe("premium ring coverage across identity surfaces", () => {
  const surfaces: Array<[string, string, string]> = [
    ["messages inbox and conversation header", "components/messages/messages-page.tsx", "conversation.otherPlan"],
    ["moments creator header", "components/content/moment-parts.tsx", "moment.authorPlan"],
    ["air creator header", "components/content/tuned-in-strip.tsx", "moment.authorPlan"],
    ["events participants", "components/events/events-page.tsx", "muddy.plan"]
  ];

  for (const [surface, path, planField] of surfaces) {
    it(`derives ${surface} rings from the server-projected plan`, () => {
      const source = read(path);
      expect(source).toContain(`publicMembershipTier(${planField})`);
      expect(source).toContain("membershipTier=");
    });
  }

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

  it("never derives a tier from a premium boolean on any wired surface", () => {
    for (const [, path] of surfaces.map((s) => [s[0], s[1]] as const)) {
      const source = read(path);
      for (const banned of ["is_premium_theme_unlocked", "isPremiumThemeUnlocked", "isPremium"]) {
        expect(source, `${path} must not infer tier from ${banned}`).not.toContain(banned);
      }
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
