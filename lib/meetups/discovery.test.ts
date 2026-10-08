import { describe, expect, it } from "vitest";
import {
  MEET_NEW_PEOPLE_RADIUS_METERS,
  MEET_NEW_PEOPLE_RESPONSE_LIMIT,
  MEETUP_OWNER_ACTIVE_LIMIT,
  discoveryTimeLeft,
  meetupDiscoveryCreateSchema
} from "@/lib/meetups/discovery";

describe("Meet New People product rules", () => {
  it("keeps discovery nearby, bounded and inside the shared Meet Up ceiling", () => {
    expect(MEET_NEW_PEOPLE_RADIUS_METERS).toBe(15_000);
    expect(MEET_NEW_PEOPLE_RESPONSE_LIMIT).toBe(6);
    expect(MEETUP_OWNER_ACTIVE_LIMIT).toBe(3);
  });

  it("keeps listing titles short enough for the card", () => {
    const base = {
      category: "coffee",
      style: "one_to_one",
      startsAt: "2027-01-01T12:00:00.000Z",
      timezone: "UTC",
      durationMinutes: 60,
      requestKey: "11111111-1111-4111-8111-111111111111"
    } as const;
    expect(meetupDiscoveryCreateSchema.safeParse({ ...base, title: "Coffee and conversation" }).success).toBe(true);
    expect(meetupDiscoveryCreateSchema.safeParse({ ...base, title: "Coffee", durationMinutes: 0 }).success).toBe(true);
    expect(meetupDiscoveryCreateSchema.safeParse({ ...base, title: "One two three four five six" }).success).toBe(false);
  });

  it("uses a disappearing listing countdown", () => {
    const now = Date.parse("2026-10-07T12:00:00Z");
    expect(discoveryTimeLeft("2026-10-07T12:30:00Z", now)).toBe("30m left");
    expect(discoveryTimeLeft("2026-10-07T14:00:00Z", now)).toBe("2h left");
  });
});
