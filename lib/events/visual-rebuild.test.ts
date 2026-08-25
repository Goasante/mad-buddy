import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments, stripFormatting } from "@/lib/content/strip-comments";
import { applyDiscoverFilter, searchEvents } from "@/lib/events/presentation";

/**
 * The Events 2.0 visual rebuild.
 *
 * These pin the STRUCTURE the approved design asked for, in the terms that can
 * actually break: which surfaces exist, which control appears in which state,
 * and -- most of all -- which controls must NOT appear. A screenshot proves a
 * screen looked right once; these prove the wrong state cannot be reached.
 */

const read = (path: string) => stripComments(readFileSync(path, "utf8"));

const page = read("components/events/events-page.tsx");
const home = read("components/events/events-home.tsx");
const discover = read("components/events/events-discover.tsx");
const yours = read("components/events/events-yours.tsx");
const hosting = read("components/events/events-hosting.tsx");
const detail = read("components/events/event-detail.tsx");
const cards = read("components/events/event-cards.tsx");
const badges = read("components/events/event-badges.tsx");
const artwork = read("components/events/event-artwork.tsx");
const selector = read("components/events/audience-selector.tsx");
const picker = read("components/events/people-picker.tsx");
const admins = read("components/events/event-admin-manager.tsx");
const updates = read("components/events/event-updates.tsx");
const mobileService = read("lib/events/mobile.ts");

// ---------------------------------------------------------------------------
// The surfaces exist and are distinct
// ---------------------------------------------------------------------------

describe("Events is four surfaces, not four filters", () => {
  it("routes to each of them", () => {
    for (const surface of ["EventsHome", "EventsDiscover", "EventsYours", "EventsHosting"]) {
      expect(page, surface).toContain(`<${surface}`);
    }
  });

  it("gives each surface its own shape rather than one shared grid", () => {
    // Home leads with a hero; Discover leads with search and segments; Hosting
    // leads with drafts. A shared card grid answering all three is the thing
    // the rebuild replaced.
    expect(home).toContain("<EventHeroCard");
    expect(discover).toContain("DISCOVER_FILTERS");
    expect(hosting).toContain("Drafts");
  });

  it("keeps exactly one hero per surface", () => {
    /* A second full-bleed card would mean neither reads as the headline. Home
     * and Your Events each render EventHeroCard once. */
    expect(home.split("<EventHeroCard").length - 1).toBe(1);
    expect(yours.split("<EventHeroCard").length - 1).toBe(1);
  });

  it("renders the truth on the server rather than waiting for hydration", () => {
    /* CAUGHT BY RUNNING THE APP, not by a type or a unit test.
     *
     * The clock used to start at 0 on the server. Zero is the epoch, so every
     * Event evaluated as PAST -- and because the surfaces filter past Events
     * out, the server-rendered page had no hero, no live badge and no rows at
     * all. It only became correct after the client mounted and set a real
     * time, which is a visible flash and, for a crawler or a slow device, is
     * simply an empty Events page.
     *
     * The route now hands down its own render time. */
    const route = read("app/(app)/events/page.tsx");
    // Read outside the component (Date.now() in a component body is impure),
    // then handed down as a prop.
    expect(route).toContain("function readServerNow()");
    expect(route).toContain("serverNowMs={serverNowMs}");
    expect(page).toContain("useState(() => serverNowMs ?? Date.now())");
    // The epoch sentinel must not come back ON THE CLOCK specifically -- an
    // unrelated useState(0) elsewhere in the file is not this bug.
    expect(page).not.toContain("const [nowMs, setNowMs] = useState(0)");
  });

  it("never shows the same Event twice on one screen", () => {
    /* CAUGHT BY LOOKING AT THE SCREENSHOT. "Upcoming for you" and "Near you"
     * both drew from the same list, so a local Event in the next few days
     * appeared in both -- the page looked padded, and Near you looked like it
     * had nothing of its own to offer. */
    expect(home).toContain("const shown = new Set(upcoming.map((event) => event.id));");
    expect(home).toContain("!shown.has(event.id)");
  });

  it("never heroes something already finished", () => {
    // A stale hero misrepresents the whole surface.
    expect(home).toContain("!describeEvent(event, nowMs).isPast");
    expect(yours).toContain('tab === "past" ? null :');
  });
});

// ---------------------------------------------------------------------------
// Discover filters are real
// ---------------------------------------------------------------------------

describe("Discover filters do what they say", () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  const make = (id: string, startIso: string, extra: Partial<Record<string, unknown>> = {}) => ({
    id,
    name: id,
    startsAt: startIso,
    endsAt: new Date(Date.parse(startIso) + 3_600_000 * 3).toISOString(),
    locality: null as string | null,
    venueLabel: null as string | null,
    goingCount: 0,
    interestedCount: 0,
    ...extra
  });

  it("drops finished Events from every segment", () => {
    // Discover is for deciding where to go; nothing over belongs in it.
    const over = make("over", "2026-08-01T12:00:00.000Z");
    for (const filter of ["for_you", "near_you", "trending", "this_weekend"] as const) {
      expect(applyDiscoverFilter([over], filter, now), filter).toHaveLength(0);
    }
  });

  it("Near you selects on the Event's own published locality", () => {
    const located = make("located", "2026-08-20T12:00:00.000Z", { locality: "Osu" });
    const unlocated = make("unlocated", "2026-08-20T12:00:00.000Z");
    const rows = applyDiscoverFilter([located, unlocated], "near_you", now);
    expect(rows.map((row) => row.id)).toEqual(["located"]);
  });

  it("Trending ranks by real counts and weights Going above Interested", () => {
    /* Intending to attend is a stronger signal than caring, so 10 Going must
     * outrank 15 Interested. A shuffle dressed as popularity would pass a
     * weaker assertion than this one. */
    const going = make("going", "2026-08-20T12:00:00.000Z", { goingCount: 10, interestedCount: 0 });
    const interested = make("interested", "2026-08-20T12:00:00.000Z", { goingCount: 0, interestedCount: 15 });
    const rows = applyDiscoverFilter([going, interested], "trending", now);
    expect(rows[0].id).toBe("going");
  });

  it("This weekend really means Saturday or Sunday", () => {
    // 2026-08-22 is a Saturday; 2026-08-20 a Thursday.
    const saturday = make("saturday", "2026-08-22T12:00:00.000Z");
    const thursday = make("thursday", "2026-08-20T12:00:00.000Z");
    const rows = applyDiscoverFilter([saturday, thursday], "this_weekend", now);
    expect(rows.map((row) => row.id)).toEqual(["saturday"]);
  });

  it("search matches name and venue, and widens nothing", () => {
    const rows = [
      { name: "AfroFuture Night", venueLabel: "Independence Square", locality: null },
      { name: "Tech Connect", venueLabel: "Impact Hub", locality: null }
    ];
    expect(searchEvents(rows, "afro")).toHaveLength(1);
    expect(searchEvents(rows, "impact")).toHaveLength(1);
    // An empty query returns what it was given -- never a wider set.
    expect(searchEvents(rows, "   ")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// State correctness on the Event surface
// ---------------------------------------------------------------------------

describe("the Event surface shows the right control for the state", () => {
  it("offers Check in only to a non-host who is live and not yet here", () => {
    expect(detail).toContain("{!event.isHost && !checkedIn && canCheckIn ? (");
  });

  it("never names Event Linkr before a check-in exists", () => {
    /* NON-NEGOTIABLE. "Meet people here" appearing to someone who has not
     * arrived implies a discovery pool they are not in. The gate leads with
     * checkedIn, evaluated independently of any server reason. */
    expect(detail).toContain("const linkrOffered = checkedIn &&");
    const gate = detail.slice(detail.indexOf("const linkrOffered ="), detail.indexOf("return ("));
    expect(gate).not.toContain("myRsvp");
    expect(gate).not.toContain("myGlowEnabled");
    // And the card is rendered inside the checked-in branch, not beside it.
    expect(detail).toContain("{linkrOffered ? (");
  });

  it("loads the same Event context however the Event was opened", () => {
    /* CAUGHT BY RUNNING THE APP. Opening /events?event=<id> -- from a
     * notification, a shared link, or the check-in success sheet -- loaded the
     * Glow roster but NOT the Linkr state, so "Meet people here" was missing on
     * exactly the same Event that showed it when opened by tapping a card.
     *
     * Both routes now call loadEventContext. */
/* The two competing effects became one, keyed on the requested id: one
       resolves the Event (from the list or through direct access) and loads its
       context either way. Two effects writing each other's state was itself the
       blank-Event bug. */
    expect(page).toContain("loadEventContext(known.id);");
    expect(page).toContain("loadEventContext(linked.id);");
    expect(page).toContain("loadEventContext(eventId);");
  });

  it("reads consent from its own stored field, not from eligibility", () => {
    /* The two differ legitimately: someone who opted in and then checked out
     * is consented but not eligible. Collapsing them would re-ask a person who
     * had already agreed. */
    expect(detail).toContain("const linkrConsented = checkedIn && linkrState?.consented === true;");
  });

  it("keeps the presence toggle out of reach without a check-in", () => {
    // Glow is a property of being here; there is nothing to share otherwise.
    const presence = detail.indexOf('id="event-presence"');
    const checkedInBranch = detail.lastIndexOf("{checkedIn ? (", presence);
    expect(checkedInBranch).toBeGreaterThan(-1);
  });

  it("shows a host no attendance control at all", () => {
    expect(detail).toContain("{event.isHost ? null : checkedIn ? (");
  });

  it("offers admin management only to the host", () => {
    /* BOUND TO THE CONTROL ITSELF, not merely to the presence of an isHost
     * check somewhere in the file. An earlier version of this test asserted
     * `{event.isHost ? (` and passed while the admin button was ungated --
     * the audience row's own host check satisfied it. The window below starts
     * at the admin control and looks BACKWARDS for the guard. */
    const adminButton = detail.indexOf("onClick={onManageAdmins}");
    expect(adminButton).toBeGreaterThan(-1);
    const guardStart = detail.lastIndexOf("{event.isHost ? (", adminButton);
    expect(guardStart).toBeGreaterThan(-1);
    // Nothing may close that conditional between the guard and the button.
    expect(detail.slice(guardStart, adminButton)).not.toContain(") : null}");

    // The sheet is gated a second time, so a stale open flag cannot leak it.
    expect(page).toContain("open={adminsOpen && Boolean(selectedEvent?.isHost)}");
    // Whitespace-tolerant: the guard is what matters, not how it wraps.
    expect(stripFormatting(page)).toContain(
      "{selectedEvent?.isHost ? ( <EventAdminManager eventId={selectedEvent.id} /> ) : null}"
    );
  });
});

// ---------------------------------------------------------------------------
// Privacy that must survive a restyle
// ---------------------------------------------------------------------------

describe("the redesign carries no location into the client", () => {
  it("keeps coordinates out of the Event projection", () => {
    /* The projection gained cover art, locality and counts. It must not have
     * gained geography: locality is a published venue label, and latitude and
     * longitude stay on the server. */
    const view = mobileService.slice(
      mobileService.indexOf("export type EventView"),
      mobileService.indexOf("export type EventResult")
    );
    for (const banned of ["latitude", "longitude", "distance", "geohash", "proximity"]) {
      expect(view.toLowerCase(), banned).not.toContain(banned);
    }
  });

  it("never renders a distance on a card", () => {
    /* NUMBERS are the thing that must never appear -- "3.2km", "500m",
     * "12 metres". Qualitative wording is exactly what the privacy rule asks
     * for instead, so "Events further away still show up under For you" is
     * correct copy, not a leak. An earlier version of this test banned the
     * substring "away" outright and would have failed that sentence. */
    for (const [name, source] of [["cards", cards], ["home", home], ["discover", discover]] as const) {
      expect(source, `${name} must not print a distance`).not.toMatch(/\d+(\.\d+)?\s*(km|m|metres|miles)/i);
      expect(source.toLowerCase(), name).not.toContain("distancemeters");
      expect(source.toLowerCase(), name).not.toContain("proximityband");
    }
  });

  it("suppresses tiny attendance counts rather than exposing them", () => {
    /* A literal count on a small private Event broadcasts "I am the only
     * person who said yes". Below the floor it shows nothing. */
    expect(badges).toContain("if (count < 3) return null;");
  });

  it("builds the Nearby step without inventing a radius control", () => {
    /* The reference draws a 1-10km slider. Event geography has one canonical
     * eligibility distance and no per-Event radius, so a slider would be a
     * control that silently does nothing. */
expect(selector).not.toContain('type="range"');
    expect(selector).not.toContain("Visibility radius");
    /* The copy now names the distinction directly: the anchor is the VENUE the
       host publishes, not where the host happens to be standing. */
    expect(selector).toContain("not your personal location");
  });
});

// ---------------------------------------------------------------------------
// Audience creation
// ---------------------------------------------------------------------------

describe("choosing an audience", () => {
  it("offers all five, each as a card rather than a native radio", () => {
    for (const id of ["invite", "link", "community", "nearby", "public"]) {
      expect(selector, id).toContain(`id: "${id}"`);
    }
    expect(selector).toContain('role="radiogroup"');
    expect(selector).toContain('role="radio"');
    expect(selector).not.toContain('type="radio"');
  });

  it("marks the selected card with more than colour", () => {
    expect(selector).toContain("aria-checked={active}");
    expect(selector).toContain("{active ? <Check");
  });

  it("changes the form with the answer", () => {
    expect(selector).toContain('value.visibility === "invite" ? (');
    expect(selector).toContain('value.visibility === "community" ? (');
    expect(selector).toContain('value.visibility === "nearby" ? (');
    expect(selector).toContain('value.visibility === "link" ? <AudienceExplanation');
    expect(selector).toContain('value.visibility === "public" ? <AudienceExplanation');
  });

  it("clears targets when the audience changes", () => {
    // Carrying an invite list into a Public Event would attach people to
    // something they were never asked about.
    expect(selector).toContain("onChange({ visibility, targetIds: [], location: value.location });");
  });

  it("counts the real selection on the confirm control", () => {
    expect(picker).toContain("confirmLabel(selectedIds.length)");
    expect(selector).toContain("`${count} selected`");
  });

  it("uses a drawn selection control with a real accessible role", () => {
    expect(picker).toContain('role={single ? "radio" : "checkbox"}');
    expect(picker).toContain("aria-checked={isSelected}");
    expect(picker).not.toContain('type="checkbox"');
  });
});

// ---------------------------------------------------------------------------
// Updates and admins
// ---------------------------------------------------------------------------

describe("Updates stay a noticeboard", () => {
  it("has no chat affordances at all", () => {
    for (const banned of ["isMine", "justify-end", "Reply", "sender"]) {
      expect(updates, banned).not.toContain(banned);
    }
  });

  it("filters by importance only when that can change the list", () => {
    // A filter that cannot alter what is shown is furniture.
    expect(updates).toContain("{importantCount > 0 ? (");
  });

  it("marks importance with a rail and the word, never colour alone", () => {
    expect(updates).toContain("border-l-2 border-primary");
    expect(updates).toContain("Important");
  });

  it("keeps reactions reachable without making them the loudest thing", () => {
    expect(updates).toContain("min-h-[2rem]");
    expect(updates).toContain("aria-pressed={mine}");
  });
});

describe("removing an admin is confirmed", () => {
  it("names the person and the consequence before doing it", () => {
    expect(admins).toContain("They will no longer be able to post updates for this event.");
    expect(admins).toContain('variant="danger"');
  });

  it("keeps destructive styling off the ordinary controls", () => {
    // Exactly one danger button on the surface: the confirmation itself.
    expect(admins.split('variant="danger"').length - 1).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Imagery and touch targets
// ---------------------------------------------------------------------------

describe("presentation fundamentals", () => {
  it("paints every Event's artwork through one component", () => {
    for (const [name, source] of [["home", home], ["discover", discover], ["yours", yours], ["hosting", hosting]] as const) {
      expect(source, name).not.toContain("<img");
    }
    expect(cards).toContain("<EventArtwork");
    expect(detail).toContain("<EventArtwork");
  });

  it("falls back to a branded treatment rather than an empty box", () => {
    expect(artwork).toContain("fallbackGradient(media.treatment)");
    expect(artwork).not.toContain("bg-gray");
  });

  it("honours the focal point the host chose", () => {
    expect(artwork).toContain("focalObjectPosition(focalX, focalY)");
  });

  it("gives rows and controls a comfortable touch target", () => {
    expect(cards).toContain("min-h-[3.5rem]");
    expect(picker).toContain("min-h-[3.25rem]");
    expect(discover).toContain("min-h-[2.25rem]");
  });

  it("respects a request for less motion", () => {
    expect(cards).toContain("motion-reduce:");
    expect(badges).toContain("motion-reduce:animate-none");
  });
});
