import { describe, expect, it } from "vitest";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard } from "@/lib/smart-card/smart-card";
import type { MeetupHomeItem } from "@/lib/meetups/rules";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const meetup: MeetupHomeItem = {
  id: "11111111-1111-4111-8111-111111111111",
  mode: "meet_somewhere",
  startsAt: "2026-10-07T13:00:00.000Z",
  timezone: "Africa/Accra",
  placeLabel: "Osu",
  title: "Coffee",
  category: "coffee",
  sourceDiscoveryId: null,
  response: "accepted"
};
function input(overrides: Partial<SmartCardInput> = {}): SmartCardInput {
  return {
    now: NOW,
    journey: null,
    safeArrival: null,
    birthday: null,
    agenda: [],
    weekendPlanCount: 0,
    nearbyFriends: [],
    locationFreshForProximity: false,
    muddyCount: 2,
    buddyScore: null,
    recentAchievement: null,
    suggestionCount: 0,
    meetups: [],
    ...overrides
  };
}
function pick(overrides: Partial<SmartCardInput> = {}, acknowledgedIds = new Set<string>()) {
  const built = input(overrides);
  return resolveSmartCard(smartCardProviders(built), { now: built.now.getTime(), acknowledgedIds });
}

describe("Meetup coordination handoff", () => {
  it("opens the canonical Meetup rather than a retired UpFor or Plan surface", () => {
    const card = pick({ meetups: [meetup] });
    expect(card?.destination).toBe("/meet-up?meetup=11111111-1111-4111-8111-111111111111");
    expect(card?.destination).not.toContain("/hangout-mode");
    expect(card?.destination).not.toContain("/plans");
  });
});
