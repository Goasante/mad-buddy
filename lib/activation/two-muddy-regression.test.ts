import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { composeHome, selectNextBestAction } from "@/lib/activation/home-composition";
import { deriveHomeMaturity } from "@/lib/activation/home-maturity";
import { resolveActivationState } from "@/lib/activation/state";
import { selectRelationshipFocus, type FocusCandidate } from "@/lib/activation/relationship-focus";

/**
 * Adding a second Muddy blanked Home.
 *
 * The relationship card, its actions and the next step all disappeared, and a
 * bare "No trusted Muddies nearby" took the whole screen -- while the server
 * had already resolved that a Muddy WAS nearby.
 */

const NOW = Date.UTC(2026, 7, 16, 21, 0, 0);
const HOUR = 60 * 60 * 1000;

/** Exactly the account in the screenshot. */
const MILESTONES = new Set([
  "profile_completed",
  "privacy_setup_completed",
  "first_request_sent",
  "first_request_accepted",
  "first_muddy_added",
  "first_message_sent"
]);

const candidates: FocusCandidate[] = [
  {
    id: "fred",
    displayName: "fred_da_red",
    avatarUrl: null,
    connectedAtMs: NOW - 48 * HOUR,
    hasSharedUpcomingPlan: false,
    conversationState: "started",
    lastConversationActivityMs: NOW - 3 * HOUR,
    waveAvailable: true
  },
  {
    id: "kofi",
    displayName: "kofi",
    avatarUrl: null,
    connectedAtMs: NOW - HOUR,
    hasSharedUpcomingPlan: false,
    conversationState: "none",
    lastConversationActivityMs: null,
    waveAvailable: true
  }
];

describe("a second Muddy does not erase what came before", () => {
  it("keeps first-value evidence", () => {
    expect(MILESTONES.has("first_message_sent")).toBe(true);
  });

  it("keeps the account at EARLY_VALUE", () => {
    /* Circle size is not maturity. Two Muddies with one one-sided conversation
     * is the same experience level as one Muddy with that conversation. */
    const maturity = deriveHomeMaturity({
      milestones: MILESTONES,
      twoSidedConversationCount: 0,
      planParticipationCount: 0,
      muddyCount: 2
    });
    expect(maturity).toBe("early_value");
  });

  it("does not re-onboard when a friendship milestone is re-recorded", () => {
    // Accepting anyone records first_muddy_added for both sides; milestones
    // accumulate, so this must not make an experienced account look younger.
    const again = new Set([...MILESTONES, "first_request_accepted", "first_muddy_added"]);
    expect(
      deriveHomeMaturity({
        milestones: again,
        twoSidedConversationCount: 0,
        planParticipationCount: 0,
        muddyCount: 2
      })
    ).toBe("early_value");
  });

  it("still finds a real relationship to talk about", () => {
    // Never null while eligible candidates exist.
    expect(selectRelationshipFocus(candidates)).not.toBeNull();
  });
});

describe("fresh location, nobody nearby, two Muddies", () => {
  const state = resolveActivationState({
    muddyCount: 2,
    pendingOutgoingCount: 0,
    locationGranted: true,
    locationFreshForProximity: true,
    visibility: "visible",
    nearbyMuddyCount: 0,
    upcomingPlanCount: 0,
    milestones: MILESTONES
  });

  it("reaches the genuine no-nearby state", () => {
    expect(state).toBe("no_one_nearby");
  });

  it("lets the Glow card own the empty room, not the Near section", () => {
    const composed = composeHome({
      activationState: state,
      acknowledgingFirstMuddy: false,
      milestones: MILESTONES,
      hasSafetyCard: false,
      upcomingPlanCount: 0,
      twoSidedConversationCount: 0,
      planParticipationCount: 0,
      muddyCount: 2,
      nextUnspokenMuddy: { id: "kofi", displayName: "kofi", avatarUrl: null },
      missingProfileItems: ["photo"]
    });
    /* THE REGRESSION: generic Near replaced relationship Home entirely. */
    expect(composed.showNearby).toBe(false);
    expect(composed.showTrending).toBe(false);
  });
});

describe("who Home talks about", () => {
  const focus = selectRelationshipFocus(candidates);

  it("chooses the unspoken relationship", () => {
    // Existing hierarchy: shared Plan -> unspoken -> recent -> newest.
    expect(focus?.muddy.id).toBe("kofi");
    expect(focus?.plan.primary).toBe("say_hi");
    expect(focus?.plan.secondary).toBe("make_plan");
  });

  it("offers no second unspoken person to process", () => {
    // Only one unspoken Muddy exists, and it is the hero.
    expect(focus?.nextUnspokenMuddy).toBeNull();
  });
});

describe("no friendship homework", () => {
  const withHeroSayHi = {
    activationState: "no_one_nearby" as const,
    acknowledgingFirstMuddy: false,
    milestones: MILESTONES,
    hasSafetyCard: false,
    upcomingPlanCount: 0,
    twoSidedConversationCount: 0,
    planParticipationCount: 0,
    muddyCount: 3,
    nextUnspokenMuddy: { id: "kojo", displayName: "Kojo", avatarUrl: null },
    heroPrimaryAction: "say_hi" as const,
    missingProfileItems: []
  };

  it("does not stack a second Say hi beneath a hero already saying it", () => {
    /* "Say hi to Ama" above "Say hi to Kojo" turns Home into a queue of social
     * obligations. One relationship at a time during early use. */
    expect(selectNextBestAction(withHeroSayHi)).toBeNull();
  });

  it("offers the unspoken person once the hero has moved on", () => {
    const heroMessaging = { ...withHeroSayHi, heroPrimaryAction: "message" as const };
    expect(selectNextBestAction(heroMessaging)).toBe("say_hi_to_muddy");
  });

  it("never falls back to Invite when several Muddies already exist", () => {
    expect(selectNextBestAction(withHeroSayHi)).not.toBe("invite_muddy");
    expect(selectNextBestAction({ ...withHeroSayHi, nextUnspokenMuddy: null })).toBeNull();
  });
});

describe("the Near section never contradicts the server", () => {
  const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));

  it("waits when the server found somebody the client has not delivered", () => {
    /* ROOT CAUSE. The nearby list is client-fetched; once it settled empty --
     * or failed -- the section claimed the room was empty, over the server's
     * own answer that a Muddy was in it. */
    /* Solved at the source instead: the client list is SEEDED from the
     * server's safe result, so it cannot be empty while the server has people
     * -- and there is no longer a skeleton condition that never clears. */
    expect(home).toContain("serverNearby.map(toDashboardFriend)");
    expect(home).not.toContain("serverNearbyCount > 0");
  });

  it("receives the server's own nearby people", () => {
    /* The count-only prop is gone: passing a number and then re-fetching the
     * same people was the shape that produced the deadlock. */
    /* NearbyHero takes no server prop of its own: Home seeds the shared
     * `friends` state, so the section and the rest of Home read one list. */
    expect(home).toContain("serverNearby.map(toDashboardFriend)");
    const route = stripComments(readFileSync("app/(app)/dashboard/page.tsx", "utf8"));
    expect(route).toContain("serverNearby={activation?.nearby ?? []}");
  });

  it("keeps one relationship surface, never a people grid", () => {
    for (const banned of ["avatar stack", "peopleCarousel", "MuddyGrid"]) {
      expect(home).not.toContain(banned);
    }
  });
});
