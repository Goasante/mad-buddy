import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    coverUrl: null,
    coverFocalX: null,
    coverFocalY: null,
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

// ---------------------------------------------------------------------------
// Event covers reach the card
// ---------------------------------------------------------------------------

describe("Event cover on the My Plans card", () => {
  const stack = readFileSync(join(process.cwd(), "components/socialize/plan-stack.tsx"), "utf8");
  const agenda = readFileSync(join(process.cwd(), "lib/social/upcoming-agenda.ts"), "utf8");

  it("carries a signed cover and its focal point through the projection", () => {
    const item = event({ coverUrl: "https://signed/cover.jpg", coverFocalX: 0.3, coverFocalY: 0.7 });
    expect(item.coverUrl).toBe("https://signed/cover.jpg");
    expect(item.coverFocalX).toBe(0.3);
    expect(item.coverFocalY).toBe(0.7);
  });

  it("signs every cover in one batched pass, never per card", () => {
    // Five Events in the stack must not become five round trips.
    expect(agenda).toContain("const coverIds = [");
    expect(agenda).toContain("await Promise.all(");
    expect(agenda).toContain("signMediaForAsset");
    // The card itself must not reach for the network.
    expect(stack).not.toContain("signMediaForAsset");
    expect(stack).not.toContain("createSupabaseBrowserClient");
  });

  it("reads the cover columns in the query it already runs", () => {
    expect(agenda).toContain("cover_media_id, cover_focal_x, cover_focal_y");
  });

  it("renders the photograph as the card background when there is one", () => {
    const card = stack.slice(stack.indexOf("function EventAgendaCard"));
    // The IMAGE element must be the thing gated on the cover -- checking for
    // "event.coverUrl ?" alone also matched the scrim beneath it, so the
    // image could be disabled while this still passed.
    const imageAt = card.indexOf("linkr-plan-image");
    expect(imageAt).toBeGreaterThan(-1);
    const imageBlock = card.slice(Math.max(0, imageAt - 400), imageAt);
    expect(imageBlock).toContain("event.coverUrl ?");
    expect(imageBlock).toContain("src={event.coverUrl}");
  });

  it("crops proportionally from the stored focal point, never stretching", () => {
    const card = stack.slice(stack.indexOf("function EventAgendaCard"));
    // The canonical helper, so every surface crops the same photo the same way.
    expect(card).toContain("focalObjectPosition(event.coverFocalX ?? 0.5, event.coverFocalY ?? 0.5)");
    expect(card).not.toContain("object-fill");
  });

  it("darkens only the photograph, so text stays readable", () => {
    const card = stack.slice(stack.indexOf("function EventAgendaCard"));
    expect(card).toContain("linkr-plan-scrim");
    // The scrim is tied to the image, not painted over the gradient too.
    const scrimAt = card.indexOf("linkr-plan-scrim");
    expect(card.slice(Math.max(0, scrimAt - 120), scrimAt)).toContain("event.coverUrl ?");
  });

  it("falls back to the Event gradient when no cover is usable", () => {
    // signMediaForAsset already refuses assets that are missing, not READY,
    // deleted or moderated, so all of those arrive here as null.
    const item = event({ coverUrl: null });
    expect(item.coverUrl).toBeNull();
    const card = stack.slice(stack.indexOf("function EventAgendaCard"));
    expect(card).toContain('"--linkr-plan-from": "#5b21b6"');
  });

  it("leaves ordinary Plans on their own branded background", () => {
    // Plans keep the wine gradient; only Events gained a photographic one.
    expect(stack).toContain("<SocializePlanCard");
    const card = stack.slice(stack.indexOf("function EventAgendaCard"));
    expect(card).not.toContain("SocializePlanCard");
  });
});
