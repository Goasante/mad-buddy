import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * The user-facing half of Events 2.0.
 *
 * Server rules are tested elsewhere; these guard the surfaces a person
 * actually touches -- that the Updates feed is a noticeboard rather than a
 * chat, that reactions are one-per-person and accessible, and that mobile
 * reaches the same server authority as the web instead of its own copy.
 */

const updatesUi = stripComments(readFileSync("components/events/event-updates.tsx", "utf8"));
const eventsPage = stripComments(readFileSync("components/events/events-page.tsx", "utf8"));
/* The Event surface moved into EventDetail in the Events 2.0 visual
 * rebuild; the page still loads the context and routes between surfaces. */
const detailUi = stripComments(readFileSync("components/events/event-detail.tsx", "utf8"));
const mobile = stripComments(readFileSync("mobile/src/screens/EventsScreen.tsx", "utf8"));
const rsvpRoute = stripComments(readFileSync("app/api/events/[id]/rsvp/route.ts", "utf8"));

describe("Updates read as a noticeboard, not a conversation", () => {
  it("renders a list rather than message bubbles", () => {
    expect(updatesUi).toContain("<ul");
    expect(updatesUi).not.toContain("isMine");
    expect(updatesUi).not.toContain("justify-end");
  });

  it("offers a composer only to someone who may publish", () => {
    expect(updatesUi).toContain("{canPublish ?");
    // The server decides too -- this only chooses whether to render it.
    expect(updatesUi).toContain("postEventUpdateAction");
  });

  it("gives attendees no composer and no reply box", () => {
    expect(updatesUi).not.toContain("Reply");
    expect(updatesUi).toContain("composerOpen && canPublish");
  });

  it("marks an edited Update rather than hiding the change", () => {
    expect(updatesUi).toContain("Edited");
  });

  it("shows importance in words, not colour alone", () => {
    expect(updatesUi).toContain("Important");
  });

  it("keeps the empty state quiet for attendees", () => {
    // An empty noticeboard is not a problem an attendee can act on.
    expect(updatesUi).toContain("canPublish ? (");
    expect(updatesUi).toContain("No updates yet.");
  });
});

describe("reactions are one per person and reachable", () => {
  it("offers the four approved reactions", () => {
    for (const type of ["heart", "fire", "applause", "wow"]) {
      expect(updatesUi, type).toContain(`"${type}"`);
    }
  });

  it("gives every emoji control an accessible name", () => {
    for (const label of [
      "React with heart",
      "React with fire",
      "React with applause",
      "React with wow"
    ]) {
      expect(updatesUi, label).toContain(label);
    }
  });

  it("exposes the selected state to assistive technology", () => {
    expect(updatesUi).toContain("aria-pressed={mine}");
  });

  it("clears the reaction when the active one is tapped again", () => {
    expect(updatesUi).toContain("current === next ? null : next");
  });

  it("keeps touch targets usable on a phone", () => {
    expect(updatesUi).toContain("min-h-[2rem]");
  });

  it("never renders who reacted", () => {
    expect(updatesUi).not.toContain("reactorNames");
    expect(updatesUi).not.toContain("reactedBy");
  });
});

describe("Meet people here is offered only when it is real", () => {
  it("keys the CTA off server-resolved eligibility", () => {
    /* Not off check-in, and not off the URL: a person browsing an Event next
     * month must never see this. */
    expect(detailUi).toContain("linkrState?.eligible");
    // The page still owns the fetch; only the gate moved.
    expect(eventsPage).toContain("getEventLinkrStateAction");
    // And presence is required independently of what the server reason says.
    expect(detailUi).toContain("const checkedIn = Boolean(event.myCheckInId);");
  });

  it("loads Event context only when a detail opens", () => {
    // A discovery feed does not need every Event's announcements.
    expect(eventsPage).toContain("loadEventContext(");
  });

  it("shows the Updates composer to delegated admins through server authority", () => {
    expect(eventsPage).toContain("canManageEventAction(eventId)");
    expect(eventsPage).toContain("setCanPublishUpdates(canManage)");
    expect(eventsPage).not.toContain("setCanPublishUpdates(isHost)");

    const actions = readFileSync("app/(app)/event-actions.ts", "utf8");
    expect(actions).toContain("export async function canManageEventAction");
    expect(actions).toContain("return access.ok && access.canManage;");
  });
});

describe("mobile reaches the same authority as web", () => {
  it("routes RSVP through the canonical service", () => {
    expect(rsvpRoute).toContain("setEventRsvp(");
    // No rules re-implemented at the transport.
    expect(rsvpRoute).not.toContain("visibility");
    expect(rsvpRoute).not.toContain("isBlocked");
  });

  it("requires authentication", () => {
    expect(rsvpRoute).toContain("resolveApiUser(");
  });

  it("offers all three answers on the phone", () => {
    for (const status of ["interested", "going", "not_going"]) {
      expect(mobile, status).toContain(`"${status}"`);
    }
  });

  it("does not paint success before the server confirms", () => {
    const handler = mobile.slice(mobile.indexOf("async function setRsvp"));
    expect(handler).toContain("if (!result.ok)");
    expect(handler.indexOf("if (!result.ok)")).toBeLessThan(handler.indexOf("void load()"));
  });

  it("gives committed Events somewhere to be found", () => {
    expect(mobile).toContain('{ id: "going", label: "Going" }');
    expect(mobile).toContain('event.myRsvp === "interested"');
  });

  it("excludes a decline from the committed list", () => {
    const filter = mobile.slice(mobile.indexOf("const filteredEvents"));
    expect(filter.slice(0, 500)).not.toContain('myRsvp === "not_going"');
  });
});
