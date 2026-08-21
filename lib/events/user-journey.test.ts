import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments, stripFormatting } from "@/lib/content/strip-comments";
import { EVENT_LOCAL_DISCOVERY_MAX_METERS } from "@/lib/events/nearby";

/**
 * What the user's own testing exposed (4K).
 *
 * Every rule here corresponds to something that was broken while a green test
 * suite said otherwise, so each comment records the failure rather than only
 * the fix. The browser harnesses prove the behaviour; these stop the specific
 * cause returning.
 */

const read = (path: string) => stripComments(readFileSync(path, "utf8"));

const page = read("components/events/events-page.tsx");
const yours = read("components/events/events-yours.tsx");
const discover = read("components/events/events-discover.tsx");
const selector = read("components/events/audience-selector.tsx");
const share = read("components/events/event-share.tsx");
const nearby = read("lib/events/nearby.ts");

// ---------------------------------------------------------------------------
// Writes must not be interruptible
// ---------------------------------------------------------------------------

describe("a publish always finishes", () => {
  it("does not run creation inside an interruptible transition", () => {
    /* THE BUG, twice over. startTransition marks work as abandonable, and React
     * abandoned it: the Server Action was aborted mid-flight. For the deep link
     * that produced a blank Event; for publishing it produced an Event with no
     * cover, no share moment, and nothing in Your Events -- a half-created
     * Event from a flow that reported success. */
    const handler = page.slice(page.indexOf("function createEvent(input"), page.indexOf("THE SURFACE ROUTER"));
    expect(handler).toContain("void (async () => {");
    expect(handler).not.toContain("startTransition(async () => {");
  });

  it("always clears its pending flag, even on an early return", () => {
    // The cover-upload failure path returns early. Without try/finally that
    // leaves the button disabled forever -- the "Publishing…" dead end.
    const handler = page.slice(page.indexOf("function createEvent(input"), page.indexOf("THE SURFACE ROUTER"));
    expect(handler).toContain("try {");
    expect(handler).toContain("} finally {");
    expect(handler).toContain("setIsWriting(false);");
  });

  it("keeps the UI disabled while a write is in flight", () => {
    // A write outside a transition no longer moves isPending, so the busy flag
    // has to combine both or the sheet would look idle mid-publish.
    expect(page).toContain("const busy = isPending || isWriting;");
    expect(page).toContain("pending={busy}");
  });
});

// ---------------------------------------------------------------------------
// The link audience is a complete loop
// ---------------------------------------------------------------------------

describe("anyone with the link can be given the link", () => {
  it("offers the link at the moment of publishing", () => {
    /* The audience existed with no delivery moment: a host chose it, published,
     * and was left holding an Event nobody could reach. */
    expect(page).toContain("setPublishedEvent({");
    expect(page).toContain("Event published");
    expect(page).toContain("<EventShare");
  });

  it("only offers it for a real publish, never a draft", () => {
    /* The rule holds, but it is now decided by the SERVER's answer rather than
     * by the shape of the request. `!input.draft` only said what was asked
     * for; a publish that was attempted and refused still satisfied it, which
     * is how a share moment appeared over an Event still sitting in Drafts.
     * `published` is publishEventAction's own result. */
    const pageFlat = stripFormatting(page);
    expect(pageFlat).toContain("if (eventId && published) { setPublishedEvent(");
    expect(pageFlat).toContain("published = publishResult.ok;");
  });

  it("lets anyone who can open the Event share it, not only the host", () => {
    /* Creation must not be the only chance to get the link -- and neither must
     * being the host. Sharing is transport, not permission: whoever receives
     * the URL still meets canViewEvent, so an attendee passing on an
     * invite-only Event grants nobody anything. */
    const detail = read("components/events/event-detail.tsx");
    const detailFlat = stripFormatting(detail);
    expect(detail).toContain("<EventShare");
    /* Scoped to the SHARE block. `event.isHost` is still used correctly
     * elsewhere on this screen -- the audience row and the admin-management
     * route are genuinely host-only -- so asserting the file contains no
     * isHost check at all would forbid two things that should stay. What
     * matters is that Share itself is not behind one. */
    const shareBlock = detailFlat.slice(detailFlat.indexOf("<EventShare"), detailFlat.indexOf("<EventShare") + 320);
    expect(shareBlock).not.toContain("isHost");
    expect(shareBlock).toContain('shareable={event.status !== "draft"}');
  });

  it("uses the existing Event URL rather than inventing a second identity", () => {
    /* Event ids are gen_random_uuid() -- 122 bits, not enumerable -- and
     * canViewEvent already grants `link` Events direct access while keeping
     * them out of every discovery surface. A share-token table would add a
     * lookup and a revocation story for no security gain. */
    expect(share).toContain("/events/${eventId}");
    expect(share).not.toContain("share_token");
  });

  it("shares through the canonical helper, with a copy fallback", () => {
    expect(share).toContain("shareInvite(");
    expect(share).toContain("navigator.clipboard.writeText");
    // Confirmation is announced, not merely painted.
    expect(share).toContain('role="status"');
    expect(share).toContain("Link copied");
  });
});

// ---------------------------------------------------------------------------
// Your Events includes what you host
// ---------------------------------------------------------------------------

describe("a host finds their own Event", () => {
  it("includes hosted Events in Yours", () => {
    /* This filtered them out entirely, so somebody who published an Event went
     * looking for it and found nothing. */
    expect(yours).toContain("event.isHost ? event.status !== \"draft\" : event.myRsvp === \"going\"");
  });

  it("marks them Hosting, never Going", () => {
    /* HOSTING IS NOT AN RSVP. Faking a `going` row to make the list work would
     * corrupt attendance counts and the Interested/Going/Check-in model --
     * setEventRsvp refuses a host server-side for exactly that reason. */
    expect(yours).toContain("function HostingMark()");
    expect(yours).toContain("if (event.isHost) return <HostingMark />;");
    const hero = yours.slice(yours.indexOf("{lead.isHost ? ("));
    expect(hero.slice(0, 400)).toContain("You&apos;re hosting");
  });

  it("keeps drafts out of Yours and in Hosting", () => {
    // An unpublished Event is unfinished work, not a commitment.
    expect(yours).toContain('event.status !== "draft"');
  });
});

// ---------------------------------------------------------------------------
// Near you means near
// ---------------------------------------------------------------------------

describe("Near you is a real proximity question", () => {
  it("reaches 5km and is never silently widened", () => {
    expect(EVENT_LOCAL_DISCOVERY_MAX_METERS).toBe(5_000);
    // No second, wider band hiding behind the first.
    expect(nearby).not.toContain("10_000");
    expect(nearby).not.toContain("25_000");
  });

  it("asks the server, because only the server may see where the viewer is", () => {
    /* The filter used to select every Event with a published locality, so in
     * one city it matched everything -- a heading promising proximity over a
     * list unrelated to where the viewer stood. */
    expect(discover).toContain("nearbyEventIdsAction");
    expect(nearby).toContain("export async function nearbyEventIdsForViewer");
  });

  it("returns ids only, never a distance", () => {
    const fn = nearby.slice(nearby.indexOf("export async function nearbyEventIdsForViewer"));
    expect(fn).toContain(".map((row) => row.eventId)");
    // The measurement is computed and then discarded.
    expect(fn).toContain("distanceMeters(");
    expect(discover).not.toContain("meters");
  });

  it("distinguishes 'cannot answer' from 'nothing near you'", () => {
    /* null means no fresh location; [] means genuinely nothing close.
     * Collapsing them would turn a location prompt into a false empty state. */
    expect(discover).toContain("nearbyIds === null");
    expect(discover).toContain("See events around you");
    expect(discover).toContain("Nothing near you right now");
  });

  it("says where a further-away Event can still be found", () => {
    // Honest about what the 5km ceiling excludes, without a number.
    expect(discover).toContain("Events further away still show up under For you and Trending.");
  });

  it("treats a stale position as no position", () => {
    expect(nearby).toContain("VIEWER_LOCATION_MAX_AGE_MS");
    expect(nearby).toContain("ageMs > VIEWER_LOCATION_MAX_AGE_MS");
  });

  it("keeps Event geography independent of the proximity engine", () => {
    // The day those rule sets share code is the day a change to friend bands
    // silently changes who can discover an Event.
    expect(nearby).not.toContain("lib/proximity");
  });
});

// ---------------------------------------------------------------------------
// Nearby creation says what it anchors to
// ---------------------------------------------------------------------------

describe("creating a Nearby Event", () => {
  it("names the venue as the anchor, not the host's own location", () => {
    expect(selector).toContain("not your personal location");
    expect(selector).toContain("People around your Event location can discover it.");
  });

  it("promises no coordinates are shown", () => {
    expect(selector).toContain("Your exact coordinates are never shown to anyone");
  });

  it("confirms the anchor on Review without a radius or coordinates", () => {
    const review = page.slice(page.indexOf('audience.visibility === "nearby" ?'));
    expect(review.slice(0, 600)).toContain("Around");
    expect(review.slice(0, 600)).not.toContain("radius");
    expect(review.slice(0, 600)).not.toContain("latitude");
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("all four Events destinations stay reachable", () => {
  it("keeps four tabs", () => {
    for (const label of ["Home", "Discover", "Yours", "Hosting"]) {
      expect(page, label).toContain(`label: "${label}"`);
    }
  });

  it("does not let Create occupy a navigation slot", () => {
    /* Create used to sit inside the tab row and, at 360px, took the space
     * Hosting needed -- so a canonical destination vanished behind a scroll
     * nobody could see. Create is a verb, not a place. */
    const tablist = page.slice(page.indexOf('role="tablist"'), page.indexOf("EVENTS_LIST"));
    expect(tablist).not.toContain("openCreate");
    expect(page).toContain("onClick={openCreate}");
  });

  it("gives the tabs equal shares so none is clipped", () => {
    expect(page).toContain("min-w-0 flex-1 truncate");
  });
});
