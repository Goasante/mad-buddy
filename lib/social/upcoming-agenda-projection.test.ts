import { describe, expect, it } from "vitest";

import {
  projectUpcomingAgenda,
  type EventAgendaItem,
  type PlanAgendaItem
} from "@/lib/social/upcoming-agenda-projection";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");

function plan(overrides: Partial<PlanAgendaItem> = {}): PlanAgendaItem {
  return {
    kind: "plan",
    id: "plan-1",
    title: "Coffee",
    startAt: "2026-08-13T14:00:00.000Z",
    startsAt: "2026-08-13T14:00:00.000Z",
    endAt: "2026-08-13T15:00:00.000Z",
    endsAt: "2026-08-13T15:00:00.000Z",
    organiserName: "Ama",
    myRsvp: "going",
    invitedCount: 2,
    goingCount: 2,
    maybeCount: 0,
    placeText: null,
    category: null,
    coverImageUrl: null,
    attendees: [],
    ...overrides
  } as PlanAgendaItem;
}

function event(overrides: Partial<EventAgendaItem> = {}): EventAgendaItem {
  return {
    kind: "event",
    id: "event-1",
    title: "Gallery night",
    startsAt: "2026-08-13T13:00:00.000Z",
    endsAt: "2026-08-13T16:00:00.000Z",
    locationLabel: "Osu",
    href: "/events?event=event-1",
    isHost: false,
    myRsvp: "interested",
    hostName: "Kofi",
    ...overrides
  };
}

describe("Home upcoming agenda projection", () => {
  it("keeps ordinary Plans and Events as distinct domain objects", () => {
    const result = projectUpcomingAgenda([plan(), event()], NOW, 8);
    expect(result.map((item) => item.kind)).toEqual(["event", "plan"]);
  });

  it("orders the unified stack by actual start time", () => {
    const result = projectUpcomingAgenda(
      [plan({ id: "later", startsAt: "2026-08-14T09:00:00.000Z" }), event({ id: "sooner" })],
      NOW,
      8
    );
    expect(result.map((item) => item.id)).toEqual(["sooner", "later"]);
  });

  it("deduplicates the same Event without converting it to a Plan", () => {
    const sameEvent = event();
    const result = projectUpcomingAgenda([sameEvent, sameEvent], NOW, 8);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "event", id: "event-1" });
  });

  it("does not mutate an Interested RSVP while projecting", () => {
    const interested = Object.freeze(event({ myRsvp: "interested" }));
    const result = projectUpcomingAgenda([interested], NOW, 8);
    expect(result[0]).toMatchObject({ kind: "event", myRsvp: "interested" });
    expect(interested.myRsvp).toBe("interested");
  });

  it("does not let an ended item lead the stack", () => {
    const ended = event({
      id: "ended",
      startsAt: "2026-08-12T10:00:00.000Z",
      endsAt: "2026-08-12T12:00:00.000Z"
    });
    expect(projectUpcomingAgenda([ended, plan()], NOW, 8).map((item) => item.id)).toEqual(["plan-1"]);
  });

  it("respects the Home render limit after sorting and deduplication", () => {
    const result = projectUpcomingAgenda([plan(), event()], NOW, 1);
    expect(result.map((item) => item.id)).toEqual(["event-1"]);
  });
});
