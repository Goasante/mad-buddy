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

describe("Home Smart Card convergence after Meetups retirement", () => {
  it("keeps exactly one current fallback", () => {
    const card = pick();
    expect(card?.id).toBe("meetup_fallback");
    expect(card?.destination).toBe("/meet-up");
  });

  it("lets the evergreen Meetups fallback cool down without hiding stronger facts", () => {
    expect(pick({}, new Set(["meetup_fallback"]))).toBeNull();
    expect(pick({ meetups: [meetup] }, new Set(["meetup_fallback"]))?.id).toBe("meetup_starting");
  });

  it("keeps cold-start people help ahead of Meetups", () => {
    expect(pick({ muddyCount: 0, suggestionCount: 3 })?.id).toBe("suggestions");
  });

  it("surfaces a confirmed Meetup that starts soon", () => {
    const card = pick({ meetups: [meetup] });
    expect(card?.id).toBe("meetup_starting");
    expect(card?.title).toBe("Coffee");
    expect(card?.destination).toContain("/meet-up?meetup=");
    expect(card?.media?.url).toBeTruthy();
  });

  it("keeps live Events above a generic fallback", () => {
    const event = {
      kind: "event" as const,
      id: "22222222-2222-4222-8222-222222222222",
      title: "Acoustic Night",
      startsAt: "2026-10-07T11:00:00.000Z",
      endsAt: "2026-10-07T14:00:00.000Z",
      locationLabel: "Osu",
      href: "/events?event=22222222-2222-4222-8222-222222222222" as const,
      isHost: false,
      myRsvp: "going" as const,
      hostName: "Nana",
      coverUrl: null,
      coverFocalX: null,
      coverFocalY: null
    };
    expect(pick({ agenda: [event] })?.id).toBe("event_live");
  });
});
