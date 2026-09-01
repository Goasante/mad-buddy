import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Journey integrations", () => {
  it("derives completion from canonical social/trust records without billing", () => {
    const service = readFileSync("lib/journey/journey-service.ts", "utf8");
    for (const source of ['from("profiles")','from("friendships")','from("activation_milestones")','from("waves")','from("messages")','from("plans")','from("safe_arrival_sessions")','from("moments")']) {
      expect(service).toContain(source);
    }
    expect(service).not.toContain("loadBillingState");
    expect(service).not.toContain("effectivePlan(");
    expect(service).not.toContain("unlock_buddy_plus");
  });

  it("keeps Journey on My Progress and Home", () => {
    expect(readFileSync("components/buddy-score/buddy-score-page.tsx", "utf8")).toContain("<JourneyProgress journey={journey}");
    const providers = readFileSync("lib/smart-card/providers.ts", "utf8");
    expect(providers).toContain('id: "journey"');
    expect(providers).toContain('id: "journey_complete"');
    expect(providers).not.toContain('id: "membership"');
  });
});
