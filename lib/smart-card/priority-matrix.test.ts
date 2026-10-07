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

describe("current Smart Card priority", () => {
  it("a confirmed Meetup starting soon beats the generic Meetups fallback", () => {
    expect(pick({ meetups: [meetup] })?.id).toBe("meetup_starting");
  });

  it("a fresh nearby Muddy beats the generic fallback", () => {
    const card = pick({
      nearbyFriends: [{
        friend_id: "33333333-3333-4333-8333-333333333333",
        username: "ama",
        display_name: "Ama",
        avatar_url: null,
        proximity_band: "close_by",
        freshness_state: "live"
      }],
      locationFreshForProximity: true
    });
    expect(card?.id).toBe("nearby_muddies");
  });

  it("a Muddy request beats the generic fallback", () => {
    expect(pick({ incomingRequestCount: 1 })?.id).toBe("muddy_request");
  });

  it("quiet mature users fall back to Meetups", () => {
    const card = pick();
    expect(card?.id).toBe("meetup_fallback");
    expect(card?.title).toBe("Turn a connection into a Meetup");
  });
});
