import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Journey integrations", () => {
  it("derives completion from current canonical social/trust records without billing or paused Moments", () => {
    const service = readFileSync("lib/journey/journey-service.ts", "utf8");
    for (const source of ['from("profiles")','from("friendships")','from("activation_milestones")','from("waves")','from("messages")','from("meetups")']) {
      expect(service).toContain(source);
    }
    expect(service).not.toContain('from("moments")');
    expect(service).not.toContain('from("plans")');
    expect(service).not.toContain('from("safe_arrival_sessions")');
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

  it("uses Meetups and removes paused or retired product steps", () => {
    const journey = readFileSync("lib/journey/journey.ts", "utf8");
    expect(journey).not.toContain("share_first_moment");
    expect(journey).not.toContain('destination: "/moments"');
    expect(journey).toContain('id: "create_first_meetup"');
    expect(journey).toContain('destination: "/meet-up?create=1"');
    expect(journey).not.toContain("create_first_plan");
    expect(journey).not.toContain("complete_first_safe_arrival");
  });
});
