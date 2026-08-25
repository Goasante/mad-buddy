import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Saying yes to an Event has to lead somewhere.
 *
 * Upcoming lists what is discoverable and Hosting lists what you made, so an
 * Event you had answered Going to was findable only by scrolling the same feed
 * you originally found it in. These tests pin the surface that closes that, and
 * the privacy boundaries the Events page must keep while doing it.
 */

const page = stripComments(readFileSync("components/events/events-page.tsx", "utf8"));
/* Events 2.0 visual rebuild. "What did I say yes to" became its own surface
 * rather than a tab on the discovery list, and the Event itself renders in
 * EventDetail. Same rules, new addresses. */
const yours = stripComments(readFileSync("components/events/events-yours.tsx", "utf8"));
const detail = stripComments(readFileSync("components/events/event-detail.tsx", "utf8"));
const service = stripComments(readFileSync("lib/events/mobile.ts", "utf8"));
const eventActions = stripComments(readFileSync("app/(app)/event-actions.ts", "utf8"));

describe("an answered Event comes back to you", () => {
  it("gives what you are attending its own surface", () => {
    /* Discovery lists what is findable and Hosting lists what you made, so an
     * Event you answered Going to used to be reachable only by scrolling the
     * same feed you originally found it in -- the one commitment the product
     * asked you to make was the one thing it would not show you back. */
    // Shortened to "Yours" so four tabs share one 360px row without scrolling.
    expect(page).toContain('{ id: "yours", label: "Yours" }');
    expect(page).toContain("<EventsYours");
  });

  it("separates the answers rather than pooling them", () => {
    // Going and Interested are different weights of yes, and Invited is not an
    // answer at all -- each gets its own tab instead of one merged list.
    for (const tab of ['"going"', '"interested"', '"invited"', '"past"']) {
      expect(yours, tab).toContain(`id: ${tab}`);
    }
  });

  it("selects on the viewer's own RSVP", () => {
    expect(yours).toContain('event.myRsvp === "going"');
    expect(yours).toContain('event.myRsvp === "interested"');
  });

  it("excludes a decline, because declining is an answer and not a plan", () => {
    // not_going must not follow anybody around.
    expect(yours).not.toContain("not_going");
  });

  it("shows an invitation only until it is answered", () => {
    // Otherwise one Event sits in Invited AND under the answer at once.
    expect(yours).toContain("event.isInvited && !event.myRsvp");
  });

  it("leaves hosting its own surface rather than mixing the two jobs", () => {
    expect(yours).toContain("events.filter((event) => !event.isHost)");
    expect(page).toContain("<EventsHosting");
  });

  it("needs no new query -- myRsvp is already projected per Event", () => {
    expect(service).toContain("myRsvp:");
  });

  it("projects the invitation flag from the audience context already loaded", () => {
    // Reuses the batched targets lookup; no per-Event invitation query.
    expect(service).toContain("isInvited: audience.invitedEventIds.has(event.id)");
  });
});

describe("each empty state answers the question its tab asked", () => {
  it("says what is missing on each tab in its own words", () => {
    /* Reworded when hosted Events joined this surface: "you have not said yes"
       is wrong for somebody whose only Event is one they are running. */
    expect(yours).toContain("Nothing coming up");
    expect(yours).toContain("Nothing on your radar");
    expect(yours).toContain("No invitations right now");
    expect(yours).toContain("No past events yet");
  });

  it("offers browsing rather than hosting where hosting is not the answer", () => {
    /* Someone who has not said yes to anything needs to look around, not run
     * an Event. Hosting is offered on the Hosting surface, where it is the
     * actual answer. */
    expect(yours).toContain('tab === "going" || tab === "interested" ? (');
    expect(yours).toContain("Browse events");
    expect(yours).not.toContain("Create");
  });

  it("keeps the hosting empty state about hosting", () => {
    const hosting = stripComments(readFileSync("components/events/events-hosting.tsx", "utf8"));
    expect(hosting).toContain("Nothing hosted yet");
    expect(hosting).toContain("Create your first event");
  });
});

describe("Events keep proximity out of attendance", () => {
  it("shows presence only where someone has explicitly checked in", () => {
    /* GlowAvatar is correct in "Muddies here" -- that list is opt-in checked-in
     * presence, not an inference from an RSVP. It must not spread to the RSVP
     * controls or the Event cards, where nobody consented to being located. */
    const glowUse = detail.slice(detail.indexOf('id="event-people-here"'));
    expect(glowUse.slice(0, 1400)).toContain("<GlowAvatar");

    const rsvpBlock = detail.slice(detail.indexOf('id="event-rsvp"'), detail.indexOf('id="event-presence"'));
    expect(rsvpBlock).not.toContain("GlowAvatar");

    /* And the roster passes NO proximityLevel, so GlowAvatar renders a plain
     * avatar. Presence at an Event means "checked in", never a distance. */
    expect(glowUse.slice(0, 1400)).not.toContain("proximityLevel");
  });

  it("never treats an RSVP as evidence of being somewhere", () => {
    // Going is an intention. Presence comes from check_ins and nothing else.
    const rsvp = service.slice(service.indexOf("export async function setEventRsvp"));
    const body = rsvp.slice(0, rsvp.indexOf("export async function createEvent"));
    expect(body).not.toContain("check_ins");
    expect(body).not.toContain("event_glow_enabled");
  });

  it("carries no attendee position or distance into the Event projection", () => {
    /* NARROWED DELIBERATELY (4F). The original banned "latitude" anywhere in
     * the service, which was right when Events had no geography at all. A
     * Nearby Event now stores a PUBLISHED VENUE -- information the host chose
     * to share about a programme -- and that is a different thing from an
     * attendee position. What must never appear is a person's whereabouts or a
     * distance between people. */
    for (const banned of ["geohash", "proximityBand", "distanceMeters", "viewerLatitude"]) {
      expect(service, `Event projection must not carry ${banned}`).not.toContain(banned);
    }
    // The EventView handed to the client still carries no geography at all.
    const view = service.slice(service.indexOf("export type EventView"), service.indexOf("export type EventResult"));
    expect(view).not.toContain("latitude");
    expect(view).not.toContain("longitude");
  });
});

describe("RSVP stays server-authoritative", () => {
  it("only records the new answer when the server accepted it", () => {
    // A refused RSVP must not paint as success -- the Plans surface shipped
    // exactly that bug once, and Events must not repeat it.
    /* Asserts the GUARD, not merely its position: an earlier version checked
     * only that `if (result.ok)` appeared before setEvents, which stayed true
     * when the condition was replaced with `if (true)`. */
    const raw = readFileSync("components/events/events-page.tsx", "utf8");
    const handler = raw.slice(raw.indexOf("function changeRsvp"), raw.indexOf("function createEvent"));
    expect(handler).toMatch(/if \(result\.ok\) \{\s*setEvents\(/);
  });

  it("refuses a host RSVPing to their own Event", () => {
    const rsvp = service.slice(service.indexOf("export async function setEventRsvp"));
    expect(rsvp.slice(0, 2000)).toContain("You're hosting this event.");
  });

  it("keeps block, visibility and terminal-status checks before the write", () => {
    const rsvp = service.slice(service.indexOf("export async function setEventRsvp"));
    const body = rsvp.slice(0, rsvp.indexOf('.from("event_rsvps")'));
    expect(body).toContain("getEventForViewer(eventId, userId)");
    expect(body).toContain('event.status === "cancelled"');
  });
});

describe("check-in uses the Event audience authority", () => {
  it("allows real invitees and rejects non-members without a second audience rule", () => {
    const checkIn = service.slice(
      service.indexOf("export async function checkInToEvent"),
      service.indexOf("export async function checkOutEvent")
    );

    expect(checkIn).toContain("getEventForViewer(eventId, userId)");
    expect(checkIn).toContain("if (!access.ok) return { ok: false, message: \"Event not found.\" };");
    expect(checkIn).not.toContain('event.visibility === "invite"');
  });

  it("guards the browser Server Action with that same authority", () => {
    const checkIn = eventActions.slice(
      eventActions.indexOf("export async function checkInToEventAction"),
      eventActions.indexOf("export async function checkOutAction")
    );

    expect(checkIn).toContain("getEventForViewer(parsed.data.eventId, userId)");
    expect(checkIn).toContain('if (!access.ok) return { ok: false, message: "Event not found." };');
    expect(checkIn.indexOf("getEventForViewer")).toBeLessThan(checkIn.indexOf('.from("check_ins")'));
  });
});
