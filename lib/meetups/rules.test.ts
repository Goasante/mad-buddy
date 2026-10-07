import { describe, expect, it } from "vitest";
import {
  meetupCreateSchema,
  meetupUpdateSchema,
  canUpdateArrival,
  meetupPhase,
  isMeetupHintFresh,
  meetupReadyForHome,
  type Meetup
} from "./rules";
import { resolveNotificationDestination } from "@/lib/notifications/destination";
import { featureForHref, featureForNotification } from "@/lib/features/availability";

const a = "10000000-0000-4000-8000-000000000001";
const b = "10000000-0000-4000-8000-000000000002";
const now = Date.parse("2026-10-06T14:00:00Z");

const member = (id: string) => ({
  key: id,
  userId: id,
  name: "Muddy",
  response: "accepted" as const,
  arrival: "not_started" as const,
  delayMinutes: null,
  metAt: null,
  suggestedStartAt: null,
  journeyState: "waiting" as const,
  observedAt: null,
  homeStartedAt: null,
  homeArrivedAt: null
});

const meetup: Meetup = {
  id: a,
  creatorId: a,
  hostId: b,
  mode: "coming_to",
  placeLabel: "Your place",
  note: "",
  startsAt: "2026-10-06T15:00:00Z",
  expiresAt: "2026-10-06T21:00:00Z",
  timezone: "Africa/Accra",
  revision: 1,
  status: "active",
  beaconStatus: "unset",
  togetherAt: null,
  members: [member(a), member(b)],
  activity: []
};

describe("Meet Up", () => {
  it("expires coarse Glow hints and rejects invalid/future-skewed timestamps", () => {
    expect(isMeetupHintFresh(new Date(now - 119_000).toISOString(), now)).toBe(true);
    expect(isMeetupHintFresh(new Date(now - 121_000).toISOString(), now)).toBe(false);
    expect(isMeetupHintFresh(new Date(now + 16_000).toISOString(), now)).toBe(false);
    expect(isMeetupHintFresh("invalid", now)).toBe(false);
    expect(isMeetupHintFresh(undefined, now)).toBe(false);
  });

  it("allows arrival only in the live window with an accepted host and peer", () => {
    expect(canUpdateArrival(meetup, a, now)).toBe(true);
    expect(canUpdateArrival({ ...meetup, members: [member(a), { ...member(b), response: "invited" }] }, a, now)).toBe(false);
    expect(canUpdateArrival({ ...meetup, status: "cancelled" }, a, now)).toBe(false);
    expect(canUpdateArrival(meetup, a, Date.parse(meetup.expiresAt))).toBe(false);
    expect(canUpdateArrival(meetup, a, Date.parse(meetup.startsAt) - 2 * 60 * 60_000 - 1)).toBe(false);
  });

  it("treats expired active rows as past and preserves the unconfirmed phase", () => {
    expect(meetupPhase(meetup, now + 2 * 60 * 60_000)).toBe("unconfirmed");
    expect(meetupPhase({ ...meetup, members: [{ ...member(a), metAt: "2026-10-06T15:00:00Z" }, member(b)] }, now + 2 * 60 * 60_000)).toBe("unconfirmed");
    expect(meetupPhase(meetup, Date.parse(meetup.expiresAt))).toBe("past");
  });

  it("requires every meetup to be scheduled and allows groups only where appropriate", () => {
    const input = {
      mode: "coming_to",
      participantIds: [a, b],
      placeLabel: "Cafe",
      startsAt: "2026-10-07T15:00:00Z",
      timezone: "Africa/Accra",
      requestKey: a
    };
    expect(meetupCreateSchema.safeParse(input).success).toBe(false);
    expect(meetupCreateSchema.safeParse({ ...input, mode: "meet_somewhere" }).success).toBe(true);
    expect(meetupCreateSchema.safeParse({ ...input, mode: "meet_somewhere", participantIds: [b], startsAt: undefined }).success).toBe(false);
    expect(meetupCreateSchema.safeParse({ ...input, mode: "meet_somewhere", participantIds: [b], when: "now" }).success).toBe(false);
  });

  it("rejects injected ownership, coordinates and retired proximity commands", () => {
    const input = {
      mode: "come_over",
      participantIds: [b],
      placeLabel: "Home",
      startsAt: "2026-10-07T15:00:00Z",
      timezone: "Africa/Accra",
      requestKey: a
    };
    expect(meetupCreateSchema.safeParse({ ...input, creatorId: b }).success).toBe(false);
    expect(meetupCreateSchema.safeParse({ ...input, latitude: 5 }).success).toBe(false);
    expect(meetupUpdateSchema.safeParse({ action: "proximity", id: a, revision: 1, requestKey: b, enabled: true }).success).toBe(false);
    expect(meetupUpdateSchema.safeParse({ action: "beacon", id: a, revision: 1, requestKey: b }).success).toBe(true);
  });

  it("keeps Home Coming Up for materialized Meetups only", () => {
    expect(meetupReadyForHome(meetup, a, now)).toBe(true);
    expect(meetupReadyForHome({ ...meetup, members: [member(a), { ...member(b), response: "invited" }] }, a, now)).toBe(false);
    expect(meetupReadyForHome({ ...meetup, members: [member(a), { ...member(b), response: "declined" }] }, a, now)).toBe(false);
    expect(meetupReadyForHome(meetup, "10000000-0000-4000-8000-000000000003", now)).toBe(false);
  });

  it("routes invitations without breaking the legacy Safe Arrival link", () => {
    expect(resolveNotificationDestination(`meetup:${a}`)?.href).toBe(`/meet-up?meetup=${a}`);
    expect(resolveNotificationDestination(`safe_arrival:${a}`)?.href).toBe(`/safe-arrival?session=${a}`);
    expect(featureForHref("/meet-up")).toBe("safe_arrival");
    expect(featureForHref("/safe-arrival")).toBe("safe_arrival");
    expect(featureForNotification(`meetup:${a}`)).toBe("safe_arrival");
    expect(featureForNotification(`safe_arrival:${a}`)).toBe(null);
  });
});
