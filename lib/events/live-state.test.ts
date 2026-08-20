import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * State correctness on the live Event screen.
 *
 * The visual review caught the forbidden combination: "Check in" and "Meet
 * people here" on screen together, which offered stranger discovery to somebody
 * who had not arrived. These tests pin the rendered gate, not just the service
 * underneath it -- the service was already right; the UI condition was not.
 */

const page = stripComments(readFileSync("components/events/events-page.tsx", "utf8"));
/* The Event surface moved into its own component in the Events 2.0 visual
 * rebuild. Every rule below is unchanged -- only where it is enforced. */
const detail = stripComments(readFileSync("components/events/event-detail.tsx", "utf8"));
const sheet = stripComments(readFileSync("components/events/meet-people-sheet.tsx", "utf8"));
const updates = stripComments(readFileSync("components/events/event-updates.tsx", "utf8"));
const banner = stripComments(readFileSync("components/socialize/event-mode-banner.tsx", "utf8"));
const feed = stripComments(readFileSync("components/socialize/discovery-feed.tsx", "utf8"));

describe("Event Linkr requires actually being here", () => {
  it("gates the CTA on a live check-in, not on eligibility alone", () => {
    /* THE BUG: the condition fired on `reason === "no_consent"` with no
     * check-in requirement, so a stale consent row surfaced the invitation to
     * somebody still looking at a Check in button. */
    expect(detail).toContain("checkedIn && (linkrState?.eligible === true || linkrState?.reason === \"no_consent\")");
    // checkedIn is its own term, evaluated independently of the server reason.
    expect(detail).toContain("const checkedIn = Boolean(event.myCheckInId);");
  });

  it("cannot be reached through Going alone", () => {
    // myRsvp never appears in the gate; intent is not presence.
    const gate = detail.slice(detail.indexOf("const linkrOffered ="), detail.indexOf("const linkrConsented ="));
    expect(gate).not.toContain("myRsvp");
  });

  it("cannot be reached through Event Glow alone", () => {
    const gate = detail.slice(detail.indexOf("const linkrOffered ="), detail.indexOf("const linkrConsented ="));
    expect(gate).not.toContain("myGlowEnabled");
  });

  it("keeps the server as the real authority", () => {
    // The client gate decides what is drawn; the server still decides access.
    expect(page).toContain("getEventLinkrStateAction");
  });
});

describe("presence outranks intent once checked in", () => {
  it("collapses the three RSVP buttons for a checked-in attendee", () => {
    // The checked-in branch renders attendance as state; the else branch is the
    // three-way RSVP control.
    expect(detail).toContain("{event.isHost ? null : checkedIn ? (");
  });

  it("states attendance instead of offering it", () => {
    expect(detail).toContain("You are here and going");
  });

  it("keeps the collapsed status readable by assistive technology", () => {
    const collapsed = detail.slice(detail.indexOf("You are here and going") - 400);
    expect(collapsed.slice(0, 500)).toContain('role="status"');
  });

  it("still offers the full RSVP choice before check-in", () => {
    // All three choices still exist for someone who has not arrived.
    expect(detail).toContain('{ status: "interested", label: "Interested" }');
    expect(detail).toContain('{ status: "going", label: "Going" }');
    expect(detail).toContain('{ status: "not_going", label: "Not going" }');
    expect(detail).toContain('role="radiogroup"');
  });
});

describe("one label for the presence switch", () => {
  it("keeps the same wording in both states", () => {
    /* This control used to rename itself between "Visible to Muddies here" and
     * "Hidden at this event", so it changed identity with its value. */
    expect(detail).toContain("Let my Muddies see I am here");
    expect(detail).not.toContain("Hidden at this event");
    expect(detail).not.toContain("Visible to Muddies here");
  });

  it("carries state on a switch rather than in the label", () => {
    expect(detail).toContain('role="switch"');
    expect(detail).toContain("aria-checked={event.myGlowEnabled}");
  });

  it("never mentions Linkr in the Muddy-visibility control", () => {
    // Event Glow is existing Muddies only. Implying strangers would be a
    // different consent entirely.
    const control = detail.slice(detail.indexOf('id="event-presence"'));
    expect(control.slice(0, 1600)).not.toContain("Linkr");
  });
});

describe("the consent sheet has two distinct states", () => {
  it("asks before consent and does not offer a way in", () => {
    expect(sheet).toContain("I&apos;m open to meeting people".replace("&apos;", "'"));
    expect(sheet).toContain("Not now");
  });

  it("does not show Turn off before consent exists", () => {
    const before = sheet.slice(sheet.indexOf("{!consented ? ("), sheet.indexOf(") : ("));
    expect(before).not.toContain("Turn off");
  });

  it("does not re-explain the promise after consent", () => {
    // The bullet list is the first-time explanation only.
    expect(sheet).toContain("{!consented ? (");
    expect(sheet).toContain("Your exact location is never shown.");
  });

  it("offers Open Linkr and a labelled way out once opted in", () => {
    expect(sheet).toContain("Open Linkr");
    expect(sheet).toContain('aria-label="Turn off event discovery"');
  });
});

describe("Updates read as information, not alarm", () => {
  it("marks importance with a rail rather than a full outline", () => {
    expect(updates).toContain('"border-l-2 border-primary pl-3"');
  });

  it("still says the word, not only the colour", () => {
    expect(updates).toContain("Important");
  });

  it("keeps reactions light but still reachable", () => {
    expect(updates).toContain("min-h-[2rem]");
    expect(updates).toContain("aria-pressed={mine}");
  });
});

describe("Event Mode says which Event", () => {
  it("leads with the Event, not with proximity", () => {
    expect(banner).not.toContain("Finding people close by");
    expect(banner).toContain("Meet people here");
  });

  it("renames the feed subtitle in Event Mode", () => {
    expect(feed).toContain("People at ${eventModeName} who are open to connecting".replace("${eventModeName}", "${eventModeName}"));
  });

  it("keeps ordinary Linkr copy when there is no Event context", () => {
    expect(feed).toContain("Find people nearby who are open to connecting");
  });
});
