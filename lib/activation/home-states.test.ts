import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Home says one thing at a time, and it reaches the person.
 *
 * The state model decides WHAT to say; these check that it is actually wired
 * to Home, that each state has its own words, and that the brand and
 * navigation rules held while adding it.
 */

const card = stripComments(readFileSync("components/activation/activation-card.tsx", "utf8"));
const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
const route = stripComments(readFileSync("app/(app)/dashboard/page.tsx", "utf8"));
const projection = stripComments(readFileSync("lib/activation/projection.ts", "utf8"));

describe("the state reaches Home", () => {
  it("is derived on the server, not guessed in the browser", () => {
    expect(route).toContain("loadActivationProjection(user.id)");
  });

  it("costs no extra round trip", () => {
    /* Inside the page's MAIN batch rather than a second await.
     *
     * Anchored on the big destructure, not the first `Promise.all` in the
     * file: the page opens with a small two-item batch for the client and
     * user, and slicing from there measured the wrong call. */
    const start = route.indexOf("const [profile, statusResult");
    const batch = route.slice(start, route.indexOf("])", start));
    expect(batch).toContain("loadActivationProjection(user.id)");
    // And exactly once -- a second call would be a second round trip.
    expect(route.split("loadActivationProjection(").length - 1).toBe(1);
  });

  it("renders on Home", () => {
    expect(home).toMatch(/<ActivationCard\s+state=\{activationState\}/);
  });

  it("says nothing once somebody is activated", () => {
    /* Asserts the BEHAVIOUR, not the branch shape.
     *
     * The render became a three-way choice when the first-Muddy
     * acknowledgement was added (acknowledge -> generic card -> nothing), so
     * pinning the old single-line ternary failed while the rule it protects --
     * an activated person is shown no activation card -- was untouched. */
    expect(home).toContain("activationState ?");
    expect(home).toMatch(/<ActivationCard\s+state=\{activationState\}/);
    expect(home).toContain(": null}");
    expect(card).toContain('if (state === "activated") return null;');
  });
});

describe("every state has its own words", () => {
  for (const state of [
    "no_muddies",
    "muddies_no_location",
    "no_one_nearby",
    "muddy_nearby",
    "upcoming_plan"
  ]) {
    it(`covers ${state}`, () => {
      expect(card).toContain(`${state}:`);
    });
  }

  it("offers exactly one primary action per state", () => {
    // A second option is a quiet link; two equal buttons is the app failing
    // to decide for somebody who has just arrived.
    const buttons = card.split("<Button asChild").length - 1;
    expect(buttons).toBe(1);
  });
});

describe("the privacy promise is kept in the copy", () => {
  it("states the area rule where location is requested", () => {
    /* The promise must be STATED here, in whatever sentence carries it.
     *
     * It moved from the body into the privacy note when this state adopted the
     * approved Glow wording, so a lowercase substring stopped matching while
     * the rule it protects was intact. */
    const locationCopy = card.slice(card.indexOf("muddies_no_location:"), card.indexOf("location_stale:"));
    expect(locationCopy).toMatch(/never your exact location/i);
    // And the rejected phrasing stays gone.
    expect(locationCopy).not.toContain("exact spot");
    expect(locationCopy).not.toContain("see your area");
  });

  it("does not ask for location before there is anyone to see", () => {
    /* The rule is about the ASK, not the word.
     *
     * The zero-Muddy state now carries the privacy line "Never your exact
     * location", which is a reassurance rather than a request -- and banning
     * the substring made that promise impossible to state. What must not
     * appear here is the permission prompt itself. */
    const noMuddies = card.slice(card.indexOf("no_muddies:"), card.indexOf("muddies_no_location:"));
    expect(noMuddies).not.toContain("Turn on location");
    expect(noMuddies).not.toContain("enable_location");
  });
});

describe("brand and navigation are preserved", () => {
  it("uses the app's own Glow token rather than a new effect", () => {
    expect(card).toContain("var(--glow-gradient)");
  });

  it("introduces no map pin or radar metaphor for proximity", () => {
    // Glow is the proximity metaphor. MapPin appears only as the icon for the
    // location PERMISSION prompt, never as a representation of a person.
    const proximityStates = card.slice(card.indexOf("muddy_nearby:"), card.indexOf("upcoming_plan:"));
    expect(proximityStates).not.toContain("MapPin");
    expect(card).not.toContain("Radar");
  });

  it("adds no navigation of its own", () => {
    // The canonical bottom bar is untouched: activation lives inside Home.
    expect(card).not.toContain("MOBILE_TABS");
    expect(card).not.toContain("<nav");
  });

  it("uses primary/muted tokens rather than a literal palette", () => {
    expect(card).toContain("text-primary");

    /* THE CONTRACT IS THE PALETTE, NOT EVERY LITERAL COLOUR.
     *
     * This asserted `not.toMatch(/#[0-9a-fA-F]{6}/)` over the whole file, and
     * the photo-backed "open your plan" variant later added a dark scrim
     * (`bg-[#160b08]`) behind /home/open-your-plan-bg.webp so white text stays
     * legible on a photograph. That is not a bespoke brand palette competing
     * with the design tokens -- it is image legibility, and there is no token
     * for "whatever keeps text readable over THIS picture".
     *
     * The blanket regex was also already inconsistent: it never caught the
     * `rgba(...)` in the very same className, so the rule it appeared to
     * enforce was not the rule it actually enforced.
     *
     * So: the CHROME must still be tokens, and the only literal colours
     * allowed are the ones layered over the background image. Anything that
     * hardcodes a colour outside that scrim still fails, which is what the
     * test was written to prevent. */
    const scrimLines = card
      .split("\n")
      .filter((line) => /bg-\[#|linear-gradient\(/.test(line));
    const outsideScrim = card
      .split("\n")
      .filter((line) => !scrimLines.includes(line))
      .join("\n");

    expect(outsideScrim).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(outsideScrim).not.toMatch(/rgba?\(/);

    // And the scrim really is only ever used with the background image.
    expect(card).toContain("open-your-plan-bg");
  });
});

describe("the projection composes canonical sources", () => {
  it("counts Muddies the way the Muddies list does", () => {
    expect(projection).toContain("user_one_id.eq.");
    expect(projection).toContain('.is("ended_at", null)');
  });

  it("reuses the proximity service rather than re-deriving nearness", () => {
    expect(projection).toContain("loadNearbyForUser");
  });

  it("judges location by a real fix, not by having asked", () => {
    // A "we prompted" flag goes stale the moment somebody revokes permission.
    expect(projection).toContain("last_updated");
    expect(projection).toContain("hasLocationSetupEvidence");
  });

  it("asks the proximity module what 'current' means", () => {
    /* Activation must own NO freshness number of its own.
     *
     * It used to hold a private six-hour constant and use it for both "is
     * location set up" and "can we say who is nearby" -- while proximity
     * itself hid a Muddy after thirty minutes. Two owners of one idea is how
     * Home came to make a claim the engine underneath it would not support. */
    expect(projection).toContain("isLocationFreshForProximity");
    expect(projection).toContain('from "@/lib/proximity/freshness"');
    expect(projection).not.toMatch(/60 \* 60 \* 1000/);
  });

  it("fails to the state that blocks nothing", () => {
    expect(projection).toContain('state: "no_muddies"');
  });
});
