import { describe, expect, it } from "vitest";
import { meetupCreateSchema, meetupUpdateSchema, canUpdateArrival, meetupPhase, isMeetupHintFresh, type Meetup } from "./rules";
import { resolveNotificationDestination } from "@/lib/notifications/destination";
import { featureForHref, featureForNotification } from "@/lib/features/availability";

const a = "10000000-0000-4000-8000-000000000001";
const b = "10000000-0000-4000-8000-000000000002";
const now = Date.parse("2026-10-06T14:00:00Z");
const member = (id: string) => ({ key: id, userId: id, name: "Muddy", response: "accepted" as const,
  arrival: "not_started" as const, delayMinutes: null, metAt: null, suggestedStartAt: null, proximityEnabled: false });
const meetup: Meetup = { id: a, creatorId: a, hostId: b, mode: "coming_to", placeLabel: "Your place", note: "",
  startsAt: "2026-10-06T15:00:00Z", timezone: "Africa/Accra", revision: 1, status: "active", members: [member(a), member(b)] };
describe("Meet Up", () => {
  it("expires nearby hints and rejects invalid or implausibly future timestamps", () => {
    expect(isMeetupHintFresh(new Date(now - 59_000).toISOString(), now)).toBe(true);
    expect(isMeetupHintFresh(new Date(now - 61_000).toISOString(), now)).toBe(false);
    expect(isMeetupHintFresh(new Date(now + 16_000).toISOString(), now)).toBe(false);
    expect(isMeetupHintFresh("invalid", now)).toBe(false);
    expect(isMeetupHintFresh(undefined, now)).toBe(false);
  });
  it("allows arrival only with an accepted host and another accepted participant", () => {
    expect(canUpdateArrival(meetup, a, now)).toBe(true);
    expect(canUpdateArrival({ ...meetup, members: [member(a), { ...member(b), response: "invited" }] }, a, now)).toBe(false);
    expect(canUpdateArrival({ ...meetup, status: "cancelled" }, a, now)).toBe(false);
    expect(canUpdateArrival(meetup, a, now - 2 * 60 * 60_000)).toBe(false);
  });
  it("does not turn an unconfirmed meeting into a failed meeting", () => {
    expect(meetupPhase(meetup, now + 2 * 60 * 60_000)).toBe("unconfirmed");
    expect(meetupPhase({ ...meetup, members: [ { ...member(a), metAt: "2026-10-06T15:00:00Z" }, member(b)] }, now + 2 * 60 * 60_000)).toBe("unconfirmed");
  });
  it("allows one host for coming to, and groups for meeting somewhere", () => {
    const input = { mode: "coming_to", participantIds: [a, b], placeLabel: "Cafe", when: "now", timezone: "Africa/Accra", requestKey: a };
    expect(meetupCreateSchema.safeParse(input).success).toBe(false);
    expect(meetupCreateSchema.safeParse({ ...input, mode: "meet_somewhere" }).success).toBe(true);
  });
  it("rejects injected ownership and coordinates", () => {
    const input = { mode: "come_over", participantIds: [b], placeLabel: "Home", when: "now", timezone: "Africa/Accra", requestKey: a };
    expect(meetupCreateSchema.safeParse({ ...input, creatorId: b }).success).toBe(false);
    expect(meetupCreateSchema.safeParse({ ...input, latitude: 5 }).success).toBe(false);
    expect(meetupUpdateSchema.safeParse({ action: "met", id: a, requestKey: b }).success).toBe(false);
  });
  it("routes new invitations without breaking legacy journey links", () => {
    expect(resolveNotificationDestination(`meetup:${a}`)?.href).toBe(`/meet-up?meetup=${a}`);
    expect(resolveNotificationDestination(`safe_arrival:${a}`)?.href).toBe(`/safe-arrival?session=${a}`);
    expect(featureForHref("/meet-up")).toBe("safe_arrival");
    expect(featureForHref("/safe-arrival")).toBe("safe_arrival");
    expect(featureForNotification(`meetup:${a}`)).toBe("safe_arrival");
    expect(featureForNotification(`safe_arrival:${a}`)).toBe(null);
  });
});
