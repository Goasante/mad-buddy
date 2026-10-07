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

describe("Meetups social heartbeat", () => {
  it("shows an upcoming confirmed Meetup", () => {
    const later = { ...meetup, startsAt: "2026-10-08T12:00:00.000Z" };
    expect(pick({ meetups: [later] })?.id).toBe("meetup_upcoming");
  });

  it("shows a starting-soon Meetup with place context", () => {
    const card = pick({ meetups: [meetup] });
    expect(card).toMatchObject({
      id: "meetup_starting",
      title: "Coffee",
      cta: "Open Meetup",
      destination: "/meet-up?meetup=11111111-1111-4111-8111-111111111111"
    });
    expect(card?.subtitle).toContain("Osu");
  });

  it("ignores declined or expired Meetups", () => {
    expect(pick({ meetups: [{ ...meetup, response: "declined" } as never] })?.id).toBe("meetup_fallback");
    expect(pick({ meetups: [{ ...meetup, startsAt: "2026-10-07T08:00:00.000Z" }] })?.id).toBe("meetup_fallback");
  });
});
