import { describe, expect, it } from "vitest";

import { SMART_CARD_APPROVED_STATES } from "@/lib/smart-card/catalog";
import { smartCardTier } from "@/lib/smart-card/home-gate";
import type { BlockedFeatureForCard } from "@/lib/smart-card/home-context";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard, SMART_CARD_IDS } from "@/lib/smart-card/smart-card";

/**
 * FAMILY 5 -- growth and recovery, and the states this product refuses to fake.
 *
 * Most of this family is deliberately NOT wired, and those absences are tested
 * here rather than merely written down. A recovery state that cannot see a real
 * failure, or a welcome-back that cannot see a real change, would be a card
 * inventing a reason to exist -- so each stays out until its authority does.
 */

const NOW = new Date("2026-08-05T10:00:00.000Z");

const blocked = (over: Partial<BlockedFeatureForCard> = {}): BlockedFeatureForCard => ({
  feature: "Linkr",
  requirement: "Add a profile photo in your profile before using Linkr.",
  href: "/profile",
  ...over
});

function input(over: Partial<SmartCardInput> = {}): SmartCardInput {
  return {
    now: NOW,
    journey: { completedCount: 8, totalCount: 8, currentStep: null, steps: [] },
    safeArrival: null,
    birthday: null,
    agenda: [],
    weekendPlanCount: 0,
    nearbyFriends: [],
    locationFreshForProximity: false,
    muddyCount: 4,
    buddyScore: null,
    recentAchievement: null,
    suggestionCount: 0,
    ...over
  };
}

const pick = (over: Partial<SmartCardInput> = {}) => {
  const built = input(over);
  return resolveSmartCard(smartCardProviders(built), {
    now: built.now.getTime(),
    acknowledgedIds: new Set(["journey_complete"])
  });
};

describe("a blocked feature is not profile completion", () => {
  it("sits in tier 5 with the other progression states", () => {
    expect(smartCardTier("profile_blocking")).toBe(5);
  });

  it("names the feature that is blocked and what it needs", () => {
    const card = pick({ blockedFeature: blocked() });
    expect(card?.id).toBe("profile_blocking");
    expect(card?.title).toBe("Add a profile photo in your profile before using Linkr.");
    expect(card?.subtitle).toBe("Linkr is on, but nobody can see you until this is done.");
    expect(card?.destination).toBe("/profile");
  });

  /**
   * The thing this state must never become. A percentage is a progress meter
   * about the viewer; this card is about a door they opened that will not let
   * them through.
   */
  it("never speaks in completion percentages", () => {
    const rendered = JSON.stringify(pick({ blockedFeature: blocked() }));
    expect(rendered).not.toMatch(/%|complete/i);
  });

  /**
   * Nothing was opened, so nothing is blocked. The reader returns null for a
   * viewer who never enabled the feature, however empty their profile is.
   */
  it("says nothing when no feature was switched on", () => {
    expect(pick({ blockedFeature: null })?.id).not.toBe("profile_blocking");
  });

  it("stays below every real social state", () => {
    const card = pick({
      blockedFeature: blocked(),
      muddyBirthdays: [{ userId: "u9", displayName: "Ama" }]
    });
    expect(card?.id).toBe("muddy_birthday");
  });

  it("stays below the Journey's completion moment but above its next step", () => {
    /* profile_blocking names a specific broken thing; Journey offers a generic
       next step. A specific problem beats a general suggestion. */
    const withStep = pick({
      blockedFeature: blocked(),
      journey: {
        completedCount: 3,
        totalCount: 8,
        currentStep: {
          id: "add_first_muddy",
          title: "Add your first Muddy",
          description: "Connect with someone you know.",
          state: "current",
          unlockCondition: "",
          destination: "/friends",
          guide: null
        },
        steps: []
      }
    });
    expect(withStep?.id).toBe("profile_blocking");
  });
});

/**
 * THE DELIBERATE ABSENCES.
 *
 * Each of these is an approved catalog state with no provider, and each has a
 * specific missing authority rather than an oversight. Asserting the absence
 * means a future provider cannot be added without this test being confronted.
 */
describe("states this product refuses to fake", () => {
  const unwired = [
    /* No user-level last-visit record exists. push_subscriptions.last_seen_at
       is device-token freshness and conversation_presence is per-conversation,
       so "what changed since you were last here" cannot be answered. */
    "returning_user",
    /* Pending and failed sends live in the Messages page's own client state,
       so a server-rendered Home cannot see them. navigator.onLine alone is not
       a pending action and must not become Home's dominant card. */
    "offline_status",
    /* No durable server-side failure queue exists to recover from. */
    "failed_action",
    /* No plan edit action exists, and no unseen-change authority either. */
    "plan_changed",
    /* Analytics, not a product reader; the joiner already arrives as a Muddy
       request. */
    "invited_friend_joined",
    /* sharedInterests is internal to candidate ranking and never exposed, so
       there is no grounded reason to put on a card. */
    "linkr_opportunity",
    /* No explicit Event invitation exists in the schema. */
    "event_invitation",
    /* Only "has a destination" exists, which counts ordinary updates. */
    "notification_action_bundle",
    /* Would need the inbox reader on every Home render, and the only cheap
       fact is a bare unread count. */
    "message_context",
    /* Monetization gating is paused. */
    "access_status",
    /* No canonical announcement source exists. */
    "feature_announcement"
  ];

  for (const id of unwired) {
    it(`${id} is approved but deliberately unwired`, () => {
      expect(SMART_CARD_APPROVED_STATES.some((state) => state.id === id)).toBe(true);
      expect(SMART_CARD_IDS as readonly string[]).not.toContain(id);
    });
  }

  /**
   * Card A owns permissions. A second permission card on the same screen is
   * the repetition the two-card architecture exists to prevent.
   */
  it("leaves both permission states to Card A", () => {
    expect(SMART_CARD_IDS as readonly string[]).not.toContain("location_permission");
    expect(SMART_CARD_IDS as readonly string[]).not.toContain("notification_permission");
  });

  /**
   * MOMENTS = NONE. It is absent from the catalog entirely, so no provider can
   * be wired for it without the product decision being reopened first.
   */
  it("keeps Moments out of the Smart Card vocabulary", () => {
    /* Whole-word, not substring: `upfor_momentum` legitimately contains
       "moment" and has nothing to do with the Moments feature. */
    const isMomentsState = (id: string) => /(^|_)moments?(_|$)/.test(id);
    expect(SMART_CARD_APPROVED_STATES.some((state) => isMomentsState(state.id))).toBe(false);
    expect((SMART_CARD_IDS as readonly string[]).some(isMomentsState)).toBe(false);
    /* And the family taxonomy has no Moments family to add one under. */
    expect(SMART_CARD_APPROVED_STATES.some((state) => state.family === ("moments" as never))).toBe(
      false
    );
  });
});

/**
 * Every wired id must be a state the catalog actually approves. This is what
 * stops a provider being added for something nobody agreed belongs on Home.
 */
describe("the wired set stays inside the approved vocabulary", () => {
  const approved = new Set<string>(SMART_CARD_APPROVED_STATES.map((state) => state.id));
  /* Two wired ids cover a catalog entry under a different name; home-gate
     resolves both through its alias map. */
  const ALIASED = new Set(["nearby_muddies", "safe_arrival"]);

  for (const id of SMART_CARD_IDS) {
    if (ALIASED.has(id)) continue;
    it(`${id} is an approved state`, () => {
      expect(approved.has(id)).toBe(true);
    });
  }

  it("gives every wired state a real tier rather than the unknown default", () => {
    for (const id of SMART_CARD_IDS) {
      expect(smartCardTier(id)).toBeLessThanOrEqual(6);
    }
    /* The fallback is the only state that may legitimately sit at tier 6. */
    const atFallbackTier = SMART_CARD_IDS.filter((id) => smartCardTier(id) === 6);
    expect(atFallbackTier).toEqual(["suggestions", "upfor_fallback"]);
  });
});
