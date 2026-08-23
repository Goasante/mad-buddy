import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Journey integrations", () => {
  it("derives completion from canonical records and effective membership on the server", () => {
    const service = readFileSync("lib/journey/journey-service.ts", "utf8");
    for (const source of [
      'from("profiles")',
      'from("friendships")',
      'from("activation_milestones")',
      'from("waves")',
      'from("messages")',
      'from("plans")',
      'from("safe_arrival_sessions")',
      'from("moments")'
    ]) expect(service).toContain(source);
    expect(service).toContain("effectivePlan(billingState");
    expect(service).toContain("getReplayableTours(userId)");
    expect(service).not.toContain("localStorage");
  });

  it("replaces the My Progress placeholder with the live Journey component", () => {
    const page = readFileSync("components/buddy-score/buddy-score-page.tsx", "utf8");
    expect(page).toContain("<JourneyProgress journey={journey}");
    expect(page).not.toContain("Coming in the next milestone.");
  });

  it("keeps the Journey on Buddy Score, with Profile linking to it rather than repeating it", () => {
    /* CHANGED by MB-GOD-013. Profile used to render its own Journey summary
     * card, which made it the second surface showing the same progress data.
     * The Journey now lives only on /buddy-score, which already rendered it in
     * more detail (asserted above), and Profile carries a single "My Progress"
     * entry point to that page.
     *
     * This asserts the CONSOLIDATION, not the removal: the Journey must still
     * exist somewhere, Profile must still offer a way to reach it, and Profile
     * must no longer render a duplicate. */
    const profile = readFileSync("components/profile/profile-page.tsx", "utf8");
    expect(profile).not.toContain("<JourneyProgress");
    expect(profile).toContain('href="/buddy-score"');

    const buddyScore = readFileSync("components/buddy-score/buddy-score-page.tsx", "utf8");
    expect(buddyScore).toContain("<JourneyProgress journey={journey}");
  });

  it("surfaces the Journey on Home through the Smart Card engine", () => {
    // Home no longer renders JourneyProgress directly. The Journey is now one
    // of ten providers behind the single Smart Card, so this asserts the
    // Journey still reaches Home — via the engine — rather than pinning a
    // variant that the Smart Card replaced.
    const home = readFileSync("components/dashboard/dashboard-page.tsx", "utf8");
    /* One hero, asserted by COUNT rather than by its exact JSX spelling.
     * The element gained a `deferred` prop and wrapped onto several lines, so
     * matching the single-line form failed while the invariant -- exactly one
     * Smart Card on Home, never a list -- was untouched. */
    expect(home).toContain("<SmartCardHero");
    expect(home).toContain("card={smartCard}");
    expect((home.match(/<SmartCardHero/g) ?? []).length).toBe(1);

    const providers = readFileSync("lib/smart-card/providers.ts", "utf8");
    expect(providers).toContain("journey.currentStep.title");
    expect(providers).toContain('id: "journey"');
    expect(providers).toContain('id: "journey_complete"');
  });

  it("replays only a server-validated published walkthrough", () => {
    const button = readFileSync("components/journey/journey-guide-button.tsx", "utf8");
    const action = readFileSync("app/(app)/tour-replay-actions.ts", "utf8");
    expect(button).toContain("startTourReplayAction");
    expect(action).toContain('eq("status", "published")');
  });
});
