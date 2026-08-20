import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments, stripFormatting } from "@/lib/content/strip-comments";

/** Whitespace-tolerant: a formatter rewrapping JSX must not fail a test. */
const flat = (source: string) => stripFormatting(source);

/**
 * The last two user-facing gaps: appointing an Event admin, and mobile asking
 * who should know about an Event.
 *
 * Both were working backend permissions with no way to reach them, which is a
 * functional gap rather than missing polish -- an unreachable capability is
 * indistinguishable from an absent one.
 */

const adminUi = stripComments(readFileSync("components/events/event-admin-manager.tsx", "utf8"));
const page = stripComments(readFileSync("components/events/events-page.tsx", "utf8"));
/* The Event surface moved into EventDetail in the Events 2.0 visual rebuild;
 * the page now routes and hosts the sheets. */
const detail = stripComments(readFileSync("components/events/event-detail.tsx", "utf8"));
const mobile = stripComments(readFileSync("mobile/src/screens/EventsScreen.tsx", "utf8"));
const service = stripComments(readFileSync("lib/events/updates.ts", "utf8"));

describe("appointing an Event admin is reachable", () => {
  it("renders only for the host", () => {
    /* TWO gates, because one is a courtesy and the other is the rule. The
     * sheet only opens for a host, AND the manager only mounts for one, so a
     * stale `adminsOpen` cannot leave it rendered after a non-host selection
     * replaces the current Event. */
    expect(page).toContain("open={adminsOpen && Boolean(selectedEvent?.isHost)}");
    expect(flat(page)).toContain("{selectedEvent?.isHost ? ( <EventAdminManager eventId={selectedEvent.id} /> ) : null}");
    // And the route in is host-only too -- no door the server would slam.
    expect(detail).toContain("{event.isHost ? (");
  });

  it("uses the canonical actions rather than its own permission logic", () => {
    for (const fn of ["listEventAdminsAction", "addEventAdminAction", "removeEventAdminAction"]) {
      expect(adminUi, fn).toContain(fn);
    }
    // No ownership decided in the component.
    expect(adminUi).not.toContain("host_id");
  });

  it("offers eligible Muddies, never a global account search", () => {
    // Same source the invitee picker uses: blocks already removed.
    expect(adminUi).toContain("getAudienceOptionsAction");
    expect(adminUi).not.toContain("ilike");
  });

  it("does not offer someone who is already an admin", () => {
    expect(adminUi).toContain("!adminIds.has(person.userId)");
  });

  it("confirms before taking a capability away", () => {
    /* Removal is silent and has no undo: the removed admin is told nothing by
     * this screen. The confirmation names the person and states the exact
     * consequence -- "are you sure?" alone tells nobody what they agreed to. */
    expect(adminUi).toContain("Remove admin");
    expect(adminUi).toContain("They will no longer be able to post updates for this event.");
    expect(adminUi).toContain('variant="danger"');
    expect(adminUi).toContain("Cancel");
  });

  it("does not paint success when the server refuses", () => {
    const add = adminUi.slice(adminUi.indexOf("function addSelected("));
    expect(add.slice(0, 600)).toContain("if (!result.ok)");
    expect(add.indexOf("if (!result.ok)")).toBeLessThan(add.indexOf("refresh()"));
    // The removal path answers to the server too, before the sheet closes.
    const remove = adminUi.slice(adminUi.indexOf("function confirmRemove("));
    expect(remove.slice(0, 600)).toContain("if (!result.ok) setError(result.message);");
  });

  it("names the affected person in its controls", () => {
    // "Remove" alone is ambiguous to a screen reader on a list of people.
    expect(adminUi).toContain("`Remove ${admin.name} as event admin`");
  });

  it("counts the actual selection rather than guessing a plural", () => {
    expect(adminUi).toContain('count === 1 ? "Add 1 admin" : `Add ${count} admins`');
  });

  it("says what an admin can actually do", () => {
    expect(adminUi).toContain("Can post updates");
    expect(adminUi).toContain("Admins can post updates for this event.");
  });

  it("keeps a restrained empty state", () => {
    // States the consequence rather than only the absence.
    expect(adminUi).toContain("No admins yet. You are the only person who can post updates.");
  });

  it("still refuses appointment by anyone but the host, server-side", () => {
    const add = service.slice(service.indexOf("export async function addEventAdmin"));
    expect(add.slice(0, 700)).toContain("isEventOwner(");
  });
});

describe("mobile asks who should know about the Event", () => {
  it("reuses the same selector as web rather than its own semantics", () => {
    expect(mobile).toContain("<AudienceSelector");
    expect(mobile).toContain("audience-selector");
  });

  it("sends the audience with the create request", () => {
    expect(mobile).toContain("visibility: audience.visibility");
    expect(mobile).toContain("audienceTargetIds: audience.targetIds");
    expect(mobile).toContain("location: audience.location ?? undefined");
  });

  it("no longer creates an Event with no audience at all", () => {
    /* The regression this closes: the mobile POST body carried no visibility,
     * so every mobile Event silently took the legacy default. */
    const start = mobile.indexOf("async function create()");
    const create = mobile.slice(start, mobile.indexOf("setBusy(false)", start));
    expect(create).toContain("visibility:");
  });

  it("does not hardcode an audience", () => {
    const start = mobile.indexOf("async function create()");
    const create = mobile.slice(start, mobile.indexOf("setBusy(false)", start));
    expect(create).not.toContain('visibility: "community"');
    expect(create).not.toContain('visibility: "public"');
  });
});
