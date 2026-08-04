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

  it("uses compact Journey summaries on Profile and Home", () => {
    const profile = readFileSync("components/profile/profile-page.tsx", "utf8");
    const home = readFileSync("components/dashboard/dashboard-page.tsx", "utf8");
    expect(profile).toContain('variant="profile"');
    expect(home).toContain('variant="home"');
    expect(readFileSync("components/journey/journey-progress.tsx", "utf8")).toContain("Continue Your Journey");
  });

  it("replays only a server-validated published walkthrough", () => {
    const button = readFileSync("components/journey/journey-guide-button.tsx", "utf8");
    const action = readFileSync("app/(app)/tour-replay-actions.ts", "utf8");
    expect(button).toContain("startTourReplayAction");
    expect(action).toContain('eq("status", "published")');
  });
});
