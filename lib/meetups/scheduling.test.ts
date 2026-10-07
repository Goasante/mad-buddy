import { describe, expect, it } from "vitest";
import { isFutureMeetupTime } from "./scheduling";
import { meetupDiscoveryCommandSchema } from "./discovery";

describe("Meetup scheduling and listing edits", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  it("allows a later time today, not only a future calendar day", () => {
    expect(isFutureMeetupTime("2026-10-07T12:02:00Z", now)).toBe(true);
    expect(isFutureMeetupTime("2026-10-07T23:00:00Z", now)).toBe(true);
    expect(isFutureMeetupTime("2026-10-08T01:00:00Z", now)).toBe(true);
  });
  it("compares instants correctly across timezone offsets", () => {
    expect(isFutureMeetupTime("2026-10-07T14:30:00+02:00", now)).toBe(true);
    expect(isFutureMeetupTime("2026-10-07T14:00:00+02:00", now)).toBe(false);
  });
  it("rejects past, invalid and too-soon times", () => {
    for (const time of ["2026-10-07T11:59:00Z", "2026-10-07T12:01:00Z", "", "invalid"]) {
      expect(isFutureMeetupTime(time, now)).toBe(false);
    }
  });
  const edit = {
    action: "edit", id: "11111111-1111-4111-8111-111111111111",
    title: "Coffee after work", category: "coffee", startsAt: "2026-10-07T18:00:00Z",
    timezone: "Africa/Accra", requestKey: "22222222-2222-4222-8222-222222222222"
  };
  it("accepts edits through the shared command schema", () => {
    expect(meetupDiscoveryCommandSchema.safeParse(edit).success).toBe(true);
  });
  it("cannot change ownership, capacity or expiry through edits", () => {
    for (const extra of [{ creatorId: edit.id }, { style: "group" }, { durationMinutes: 240 }, { listingExpiresAt: edit.startsAt }]) {
      expect(meetupDiscoveryCommandSchema.safeParse({ ...edit, ...extra }).success).toBe(false);
    }
    expect(meetupDiscoveryCommandSchema.safeParse({ ...edit, title: "one two three four five six" }).success).toBe(false);
  });
});
