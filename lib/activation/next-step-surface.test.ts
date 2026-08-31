import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { composeHome, type HomeCompositionInputs } from "@/lib/activation/home-composition";

/**
 * One recommendation is not a grid with two cards missing.
 *
 * The single next step reused the rail's fixed-width tile -- sized so three fit
 * with a fourth peeking -- so rendering one left two thirds of the row empty
 * and read as a loading failure rather than a deliberate ending.
 */

const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));

/** The single-action surface only, not the rail that shares its card. */
const nextStep = home.slice(home.indexOf("function NextForYou"), home.indexOf("function SuggestionCard"));

const inputs = (over: Partial<HomeCompositionInputs> = {}): HomeCompositionInputs => ({
  activationState: "no_one_nearby",
  acknowledgingFirstMuddy: false,
  milestones: new Set(["first_muddy_added", "first_message_sent"]),
  hasSafetyCard: false,
  upcomingPlanCount: 0,
  twoSidedConversationCount: 0,
  planParticipationCount: 0,
  muddyCount: 1,
  nextUnspokenMuddy: null,
  missingProfileItems: [],
  ...over
});

describe("the single step is presented as a row", () => {
  it("does not reuse the fixed-width rail tile", () => {
    /* SuggestionCard is w-[7.75rem] shrink-0 -- a carousel card. One of them
     * sitting alone is what made the screen look unfinished. */
    expect(nextStep).not.toContain("<SuggestionCard");
    expect(nextStep).not.toContain("w-[7.75rem]");
  });

  it("fills the available width", () => {
    expect(nextStep).toContain("flex items-center");
    expect(nextStep).toContain("flex-1");
  });

  it("carries a clear affordance", () => {
    expect(nextStep).toContain("<ChevronRight");
  });

  it("uses no carousel or grid container", () => {
    for (const railish of ["overflow-x-auto", "grid-cols", "shrink-0 flex-col", "railRef"]) {
      expect(nextStep).not.toContain(railish);
    }
  });

  it("carries no large illustration", () => {
    expect(nextStep).not.toContain("<Image");
    expect(nextStep).not.toContain("illustration");
  });
});

describe("it reads as a step, not a feed", () => {
  it("is titled as a step", () => {
    expect(nextStep).toContain('title="Next step"');
  });

  it("avoids recommendation-feed language", () => {
    for (const feedish of ["Recommended", "Trending for you", "Because you", "Explore more", "For you"]) {
      expect(nextStep).not.toContain(feedish);
    }
  });

  it("uses the shared section header rather than a bespoke heading", () => {
    expect(nextStep).toContain("<PageSectionHeader");
    // No invented giant heading competing with the Glow card above.
    expect(nextStep).not.toMatch(/text-(2xl|3xl|4xl)/);
  });
});

describe("it does not restate what is already on screen", () => {
  it("is more specific than the header's generic Add Muddy", () => {
    /* The header person-plus goes to /friends?tab=requests -- a generic people
     * entry carrying the pending-request badge. This names the narrower job:
     * bringing somebody who is not on Mad Buddy yet. */
    const header = readFileSync("components/app-shell/mobile-page-header.tsx", "utf8");
    expect(header).toContain('href="/friends?tab=requests"');
    expect(home).toContain('label: "Invite another Muddy"');
    expect(home).toContain('href: "/invites"');
  });

  it("never offers Make a Plan as the growth step", () => {
    // It already exists as the secondary action on the card directly above.
    const resolver = home.slice(home.indexOf("function resolveNextStep"), home.indexOf("function NextForYou"));
    expect(resolver).not.toContain("make_plan");
    expect(resolver).not.toContain("/plans?create=1");
  });

  it("never promotes UpFor", () => {
    const resolver = home.slice(home.indexOf("function resolveNextStep"), home.indexOf("function NextForYou"));
    expect(resolver).not.toContain("/hangout-mode");
  });
});

describe("at most one action, chosen deterministically", () => {
  it("renders a single action or none", () => {
    const composed = composeHome(inputs());
    expect(composed.nextBestAction).toBe("invite_muddy");
    // The rail is the alternative presentation and must stay off.
    expect(composed.showSuggestions).toBe(false);
  });

  it("keeps the suppressed modules suppressed", () => {
    const composed = composeHome(inputs());
    expect(composed.showTrending).toBe(false);
    expect(composed.showJourneyCard).toBe(false);
    expect(composed.showProfileReminder).toBe(false);
    expect(composed.showMoments).toBe(false);
  });

  it("renders nothing rather than a filler card", () => {
    // Whitespace is a legitimate ending.
    const settled = inputs({ muddyCount: 9, missingProfileItems: [] });
    expect(composeHome(settled).nextBestAction).toBeNull();
    expect(home).toContain("{nextStep ? <NextForYou step={nextStep} /> : null}");
  });

  it("leaves established Home untouched", () => {
    const established = composeHome(inputs({ twoSidedConversationCount: 1, activationState: null }));
    expect(established.showSuggestions).toBe(true);
    expect(established.nextBestAction).toBeNull();
  });
});

describe("accessibility", () => {
  it("announces the action and its reason together", () => {
    expect(nextStep).toContain("aria-label={`${step.label}. ${step.description}`}");
  });

  it("hides the decorative glyphs from screen readers", () => {
    expect(nextStep.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("wraps supporting text instead of truncating it", () => {
    // Meaning must survive large text rather than vanish behind an ellipsis.
    expect(nextStep).not.toContain("truncate");
    expect(nextStep).not.toContain("line-clamp");
  });

  it("respects reduced motion", () => {
    expect(nextStep).toContain("motion-reduce:");
  });

  it("uses theme tokens rather than a separate mini-brand", () => {
    expect(nextStep).toContain("bg-card/60");
    expect(nextStep).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
