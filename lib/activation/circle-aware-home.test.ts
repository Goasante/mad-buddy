import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import {
  selectNextBestAction,
  type HomeCompositionInputs
} from "@/lib/activation/home-composition";
import { selectRelationshipFocus, type FocusCandidate } from "@/lib/activation/relationship-focus";

/**
 * Use the circle before growing it.
 *
 * Home assumed everyone had exactly one Muddy, so it kept offering "Invite
 * another Muddy" to people who had already added three and spoken to one --
 * pushing acquisition at somebody whose existing relationships were sitting
 * untouched.
 */

const NOW = Date.UTC(2026, 7, 16, 20, 0, 0);
const HOUR = 60 * 60 * 1000;

const muddy = (id: string, over: Partial<FocusCandidate> = {}): FocusCandidate => ({
  id,
  displayName: `Muddy ${id}`,
  avatarUrl: null,
  connectedAtMs: NOW - 24 * HOUR,
  hasSharedUpcomingPlan: false,
  conversationState: "none",
  lastConversationActivityMs: null,
  waveAvailable: true,
  ...over
});

const home = (over: Partial<HomeCompositionInputs> = {}): HomeCompositionInputs => ({
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

describe("one Muddy, already spoken to", () => {
  it("still suggests growing the circle", () => {
    // Nobody else here to talk to, so another person genuinely is the next
    // useful thing. This case is locked.
    expect(selectNextBestAction(home({ muddyCount: 1 }))).toBe("invite_muddy");
  });
});

describe("several Muddies, one still unspoken", () => {
  const withUnspoken = home({
    muddyCount: 3,
    nextUnspokenMuddy: { id: "b", displayName: "Ama", avatarUrl: null }
  });

  it("uses the existing relationship instead of inviting", () => {
    expect(selectNextBestAction(withUnspoken)).toBe("say_hi_to_muddy");
  });

  it("does not push acquisition at somebody who already has a circle", () => {
    expect(selectNextBestAction(withUnspoken)).not.toBe("invite_muddy");
  });

  it("keeps choosing the relationship however large the circle", () => {
    for (const muddyCount of [2, 5, 12, 40]) {
      expect(selectNextBestAction({ ...withUnspoken, muddyCount })).toBe("say_hi_to_muddy");
    }
  });
});

describe("several Muddies, all underway", () => {
  it("says nothing rather than inventing a task", () => {
    /* The hero already carries the conversation and Make a Plan. Inviting more
     * people while the existing ones are active is collection, not connection.
     * Home is allowed to end. */
    expect(selectNextBestAction(home({ muddyCount: 4 }))).toBeNull();
  });

  it("does not fall back to profile administration", () => {
    expect(selectNextBestAction(home({ muddyCount: 4, missingProfileItems: ["photo"] }))).toBeNull();
  });
});

describe("the next step never restates the hero", () => {
  it("excludes the focused person from the runner-up", () => {
    /* "Say hi to Ama" underneath a card already saying "Say hi" to Ama is one
     * screen offering two routes to the same tap. */
    const focus = selectRelationshipFocus([muddy("a"), muddy("b")]);
    expect(focus?.muddy.id).toBeTruthy();
    expect(focus?.nextUnspokenMuddy?.id).not.toBe(focus?.muddy.id);
  });

  it("offers no runner-up when the only unspoken person is the hero", () => {
    const focus = selectRelationshipFocus([muddy("solo")]);
    expect(focus?.muddy.id).toBe("solo");
    expect(focus?.nextUnspokenMuddy).toBeNull();
  });

  it("offers no runner-up when everyone else has been spoken to", () => {
    const focus = selectRelationshipFocus([
      muddy("new"),
      muddy("chatty", { conversationState: "established", lastConversationActivityMs: NOW - HOUR })
    ]);
    expect(focus?.muddy.id).toBe("new");
    expect(focus?.nextUnspokenMuddy).toBeNull();
  });

  it("is stable across repeated calls", () => {
    const set = [muddy("a"), muddy("b"), muddy("c")];
    const first = selectRelationshipFocus(set);
    for (let i = 0; i < 5; i += 1) {
      expect(selectRelationshipFocus(set)).toEqual(first);
    }
  });
});

describe("multiple Muddies before first value", () => {
  it("focuses a real relationship rather than acquisition", () => {
    /* Three people added, nothing said. The circle already exists; the gap is
     * that nobody has spoken. */
    const focus = selectRelationshipFocus([muddy("ama"), muddy("kwame"), muddy("kojo")]);
    expect(focus?.plan.primary).toBe("say_hi");
    expect(focus?.nextUnspokenMuddy).not.toBeNull();
  });

  it("does not require interacting with every Muddy", () => {
    // One hello is first value; the others remain available, not required.
    const activating = home({
      milestones: new Set(["first_muddy_added"]),
      muddyCount: 3,
      nextUnspokenMuddy: { id: "b", displayName: "Kwame", avatarUrl: null }
    });
    expect(selectNextBestAction(activating)).toBe("say_hi_to_muddy");
  });
});

describe("stronger signals still win", () => {
  it("a shared Plan outranks an unspoken relationship", () => {
    const focus = selectRelationshipFocus([
      muddy("unspoken"),
      muddy("planned", { hasSharedUpcomingPlan: true, conversationState: "established" })
    ]);
    expect(focus?.muddy.id).toBe("planned");
    expect(focus?.plan.primary).toBe("view_plan");
  });

  it("stale location does not change who is chosen", () => {
    /* Proximity truth and relationship selection are separate: nothing in the
     * selector reads a location, so a stale fix cannot reshuffle people. */
    const source = stripComments(readFileSync("lib/activation/relationship-focus.ts", "utf8"));
    for (const leak of ["proximity", "distance", "band", "latitude", "stale"]) {
      expect(source).not.toContain(leak);
    }
  });
});

describe("the next step speaks about a real person", () => {
  const dashboard = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
  const resolver = dashboard.slice(
    dashboard.indexOf("function resolveNextStep"),
    dashboard.indexOf("function NextForYou")
  );

  it("names them", () => {
    expect(resolver).toContain("Say hi to ${muddy.displayName}");
  });

  it("renders nothing rather than a nameless placeholder", () => {
    // Never "Say hi to your Muddy".
    expect(resolver).toContain("if (!muddy) return null;");
  });

  it("uses friendship language, not network language", () => {
    /* Scoped to the next-step COPY. A file-wide scan flagged the network
     * resilience import and a comment about network failures -- banning those
     * would force unrelated infrastructure to be renamed for a copy rule. */
    for (const networky of ["your network", "connections", "followers", "People you may know"]) {
      expect(resolver).not.toContain(networky);
    }
  });

  it("adds no count goals or popularity mechanics", () => {
    for (const pressure of ["Add 5", "friends to continue", "progress toward", "streak"]) {
      expect(dashboard).not.toContain(pressure);
    }
  });

  it("keeps a stable identity for future guidance", () => {
    expect(resolver).toContain('actionId: "say_hi_to_muddy"');
    expect(resolver).toContain('actionId: "invite_muddy"');
    expect(dashboard).toContain("data-home-action={step.actionId}");
  });
});

describe("the option set stays small and justified", () => {
  it("offers only the outcomes product state justifies", () => {
    const source = stripComments(readFileSync("lib/activation/home-composition.ts", "utf8"));
    expect(source).toContain('export type NextBestAction = "invite_muddy" | "say_hi_to_muddy" | null');
  });

  it("admits no feature discovery", () => {
    const source = stripComments(readFileSync("lib/activation/home-composition.ts", "utf8"));
    const selector = source.slice(
      source.indexOf("export function selectNextBestAction"),
      source.indexOf("export function composeHome")
    );
    for (const banned of ["upfor", "hangout", "events", "trending", "premium"]) {
      expect(selector.toLowerCase()).not.toContain(banned);
    }
  });

  it("uses no arbitrary circle-size quota beyond the single-Muddy case", () => {
    /* muddyCount <= 1 is a real product statement -- there is nobody else to
     * talk to. The old `<= 4` threshold was a quota with no meaning. */
    const source = stripComments(readFileSync("lib/activation/home-composition.ts", "utf8"));
    const selector = source.slice(
      source.indexOf("export function selectNextBestAction"),
      source.indexOf("export function composeHome")
    );
    expect(selector).not.toContain("<= 4");
    expect(selector).not.toContain(">= 3");
  });
});
