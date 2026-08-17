import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { planActionsForMuddy } from "@/lib/activation/state";

/**
 * When your friends are close, they glow.
 *
 * A genuine nearby Muddy is the moment the product exists for, and it rendered
 * as a 76px cell in a scroll rail beside a "See all" that expanded a list of
 * one -- the same treatment four people get, so one person read as a list that
 * had mostly failed to load.
 */

const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
const nearSection = home.slice(
  home.indexOf("function NearbyHero"),
  home.indexOf("// First-time quick actions")
);
/** The focused-hero branch only, not the fallback rail beneath it. */
const solo = nearSection.slice(
  nearSection.indexOf("heroFriend ? ("),
  nearSection.indexOf("total > 0 ? (")
);

describe("one nearby Muddy gets a hero, not a rail cell", () => {
  it("has its own branch", () => {
    /* Generalised in 3G.1: one person still leads, but the hero now applies at
     * any nearby count with the others compact beneath. */
    expect(nearSection).toContain("const heroFriend =");
    expect(nearSection).toContain("heroFriend ? (");
  });

  it("does not use the fixed rail column width", () => {
    // w-[4.75rem] shrink-0 is the carousel cell; the hero must not reuse it.
    expect(solo).not.toContain("w-[4.75rem]");
    expect(solo).not.toContain("overflow-x-auto");
  });

  it("gives the Glow a bigger stage", () => {
    expect(solo).toContain('size="lg"');
  });

  it("names the person legibly", () => {
    expect(solo).toContain("firstName(heroFriend.displayName || heroFriend.username)");
  });

  it("leads with the relationship the selector already chose", () => {
    // Not a second ranking system: the same focus the rest of Home uses.
    expect(nearSection).toContain("friends.find((f) => f.friendId === focusedId)");
  });
});

describe("the Glow stays truthful", () => {
  it("passes the canonical proximity inputs unchanged", () => {
    for (const prop of [
      "proximityLevel={heroFriend.proximityLevel}",
      "glowStrength={heroFriend.glowStrength}",
      "confidence={heroFriend.confidence}"
    ]) {
      expect(solo).toContain(prop);
    }
  });

  it("uses the canonical component rather than a second glow", () => {
    expect(solo).toContain("<GlowAvatar");
  });

  it("invents no intensity for the focused Muddy", () => {
    /* Only the SIZE differs for the hero. Boosting intensity would overstate a
     * band the server resolved -- emphasis may increase, truth may not.
     *
     * Scoped to the hero's own GlowAvatar: the supporting rows below reuse the
     * rail's existing NEAR_GLOW_INTENSITY damping, which is a restraint rather
     * than an exaggeration. */
    const heroGlow = solo.slice(solo.indexOf("<GlowAvatar"), solo.indexOf("</button>"));
    expect(heroGlow).not.toContain("intensity={");
  });

  it("damps the supporting rows rather than amplifying them", () => {
    const supportingBlock = solo.slice(solo.indexOf("Also close"));
    expect(supportingBlock).toContain("intensity={NEAR_GLOW_INTENSITY}");
    expect(supportingBlock).toContain('size="sm"');
  });

  it("respects reduced motion", () => {
    expect(solo).toContain("reducedMotion={reducedMotion}");
  });
});

describe("privacy survives the redesign", () => {
  it("shows the canonical label, never a measurement", () => {
    expect(solo).toContain("proximityLabels[heroFriend.proximityLevel]");
    for (const leak of [" km", "metres", "meters", "miles", "away", "coordinates", "street"]) {
      expect(solo).not.toContain(leak);
    }
  });

  it("adds no map, radar or direction", () => {
    for (const banned of ["Map", "Radar", "compass", "direction", "bearing"]) {
      expect(solo).not.toContain(banned);
    }
  });

  it("exposes no location age", () => {
    expect(solo).not.toContain("lastUpdated");
    expect(solo).not.toContain("freshnessState");
  });
});

describe("the proximity label carries its own meaning", () => {
  it("does not repeat itself with a coloured dot", () => {
    /* The rail pairs a dot with the word; in the hero the word is large
     * enough to stand alone, and a dot beside it says the same thing twice. */
    expect(solo).not.toContain("PROXIMITY_DOT_CLASS");
  });

  it("announces person and proximity together for screen readers", () => {
    expect(solo).toContain("proximityLabels[heroFriend.proximityLevel]}. Open profile");
  });
});

describe("actions arrive at the payoff", () => {
  it("renders the actions Home supplies", () => {
    expect(solo).toContain("{soloActions}");
  });

  it("decides them with the one engine", () => {
    expect(home).toContain("planActionsForMuddy({");
    expect(home).toContain("isNearby: true");
  });

  it("only offers them for the person actually on screen", () => {
    // Otherwise the pair would describe somebody who is not shown.
    expect(home).toContain("relationshipFocus?.muddy.id === soloNearbyMuddy.friendId");
  });

  it("routes a Wave through the canonical action", () => {
    expect(home).toContain("sendWaveV2Action(muddyId)");
    expect(home).toContain('from "@/app/(app)/social-actions"');
  });

  it("guards against a double tap", () => {
    const handler = home.slice(home.indexOf("function waveAtMuddy"), home.indexOf("RSVP from the Home"));
    expect(handler).toContain("if (isPending) return;");
  });
});

describe("the action hierarchy at the moment of proximity", () => {
  const ctx = (over: Record<string, unknown> = {}) =>
    planActionsForMuddy({
      hasSharedUpcomingPlan: false,
      hasExistingConversation: false,
      conversationState: "none",
      isNearby: true,
      waveAvailable: true,
      ...over
    } as never);

  it("offers Say hi then Wave to somebody new who is here now", () => {
    /* A Plan is the heavier follow-up; a Wave matches the moment -- one tap,
     * no obligation, and it means something because they are actually here. */
    const plan = ctx();
    expect(plan.primary).toBe("say_hi");
    expect(plan.secondary).toBe("wave");
  });

  it("never offers a Wave the server would refuse", () => {
    const blocked = ctx({ waveAvailable: false });
    expect(blocked.secondary).not.toBe("wave");
    expect(blocked.secondary).toBe("make_plan");
  });

  it("still refuses to wave at somebody who is not nearby", () => {
    // The original rule stands: a wave with no context is a gesture at nobody.
    const distant = ctx({ isNearby: false });
    expect(distant.primary).not.toBe("wave");
    expect(distant.secondary).not.toBe("wave");
  });

  it("keeps Wave primary for an established nearby relationship", () => {
    const established = ctx({ hasExistingConversation: true, conversationState: "established" });
    expect(established.primary).toBe("wave");
    expect(established.secondary).toBe("message");
  });

  it("falls back to Message on cooldown, never a dead button", () => {
    const cooled = ctx({
      hasExistingConversation: true,
      conversationState: "established",
      waveAvailable: false
    });
    expect(cooled.primary).toBe("message");
  });

  it("lets a shared Plan outrank the proximity moment", () => {
    const planned = ctx({ hasSharedUpcomingPlan: true, hasExistingConversation: true });
    expect(planned.primary).toBe("view_plan");
    expect(planned.secondary).not.toBe("make_plan");
  });
});

describe("several nearby Muddies keep the compact rail", () => {
  it("renders exactly one hero however many are nearby", () => {
    // Everyone else is filtered out of the supporting list by id.
    expect(nearSection).toContain("friends.filter((f) => f.friendId !== heroFriend.friendId)");
    expect(nearSection).toContain("NEARBY_SUPPORTING_LIMIT");
  });

  it("caps how many positions are shown", () => {
    expect(nearSection).toContain("NEARBY_MAX_POSITIONS");
  });

  it("offers See all only when somebody is genuinely hidden", () => {
    expect(nearSection).toContain('href={hiddenCount > 0 ? "/friends" : undefined}');
  });

  it("keeps the server/client consistency guarantee", () => {
    /* 3F.4 met this with a count-only conditional that could never clear once
     * the client list settled empty. Solved at the source instead: the client
     * list is SEEDED from the server's safe result, so it cannot be empty
     * while the server has people, and the skeleton always terminates. */
    expect(home).toContain("serverNearby.map(toDashboardFriend)");
    expect(nearSection).toContain("total === 0 && !loaded");
  });
});
