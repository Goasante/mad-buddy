import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments, stripFormatting } from "@/lib/content/strip-comments";
import { AUDIENCE_EXPLANATION } from "@/lib/events/presentation";

/** Whitespace-tolerant: a formatter rewrapping JSX must not fail a test. */
const flat = (source: string) => stripFormatting(source);

/**
 * The 4J correction pass.
 *
 * Each test below corresponds to a defect found by looking at a screenshot of
 * the running app rather than by reading code, so each one pins a specific
 * regression: stale copy that contradicted the form beside it, a creation flow
 * that behaved like one long administrative page, fields nobody could tell were
 * editable, and a fallback that looked unfinished.
 */

const read = (path: string) => stripComments(readFileSync(path, "utf8"));

const page = read("components/events/events-page.tsx");
const selector = read("components/events/audience-selector.tsx");
const cover = read("components/events/event-cover-field.tsx");
const artwork = read("components/events/event-artwork.tsx");
const cards = read("components/events/event-cards.tsx");
const discover = read("components/events/events-discover.tsx");

// ---------------------------------------------------------------------------
// Stale copy
// ---------------------------------------------------------------------------

describe("Create Event never answers the question it is asking", () => {
  it("drops the hardcoded community description from the sheet header", () => {
    /* THE BUG: the sheet's subtitle read "Visible to the community" -- true
     * back when creation hardcoded that audience -- and stayed on screen while
     * somebody had Public selected two inches below it. */
    expect(page).not.toContain("Visible to the community.");
  });

  it("uses neutral header copy that suits every audience", () => {
    expect(page).toContain("Bring people together around something happening.");
  });

  it("shows audience copy only where the audience is chosen", () => {
    // The explanation lives in the audience step, keyed off the real value.
    expect(selector).toContain('value.visibility === "link" ? <AudienceExplanation');
    expect(selector).toContain('value.visibility === "public" ? <AudienceExplanation');
  });

  it("promises only distribution the product actually performs", () => {
    /* Public Events really can surface in Home, Discover and Near you --
     * listNearbyEvents filters on isDiscoverableInFeed, which admits public.
     * Search is not built, so the copy must not imply it. */
    const publicCopy = AUDIENCE_EXPLANATION.public.lines.join(" ").toLowerCase();
    expect(publicCopy).toContain("near you");
    expect(publicCopy).not.toContain("search");
    expect(publicCopy).not.toContain("everyone will");
  });
});

// ---------------------------------------------------------------------------
// A guided flow rather than one long form
// ---------------------------------------------------------------------------

describe("creation is staged", () => {
  it("defines the four stages", () => {
    expect(page).toContain('const STAGES = ["audience", "basics", "when", "review"] as const;');
  });

  it("gates each stage on what that stage asked for", () => {
    // Advancing from Audience with no invitees chosen would carry an empty
    // audience into an Event that requires one.
    expect(page).toContain("const audienceReady =");
    expect(page).toContain("const basicsReady = name.trim().length >= 2;");
    expect(page).toContain("const whenReady = Boolean(date && startTime && endTime && !scheduleInvalid);");
  });

  it("offers Publish only at Review", () => {
    /* Publishing from stage one would skip the confirmation the Review step
     * exists to provide. Continue carries every earlier stage. */
    expect(page).toContain('{stage === "review" ? (');
    expect(page).toContain("Continue");
  });

  it("keeps earlier stages mounted so a step back loses nothing", () => {
    // `hidden` rather than unmounting: a half-typed time must survive Back.
    expect(page).toContain('className={cn(stage === "basics" ? "space-y-5" : "hidden")}');
    expect(page).toContain('className={cn(stage === "when" ? "space-y-5" : "hidden")}');
  });

  it("shows progress without an admin-form step counter", () => {
    // Dots for sighted readers; the counter exists only for screen readers.
    expect(page).toContain("STAGES.map((entry, index) => (");
    expect(page).toContain("sr-only");
    expect(page).toContain("Step {stageIndex + 1} of {STAGES.length}");
  });

  it("returns to the first stage when the sheet is reset", () => {
    // Reopening mid-flow would strand somebody on a Review for an Event that
    // no longer exists.
    expect(page).toContain('setStage("audience");');
  });
});

// ---------------------------------------------------------------------------
// Fields that look editable
// ---------------------------------------------------------------------------

describe("form fields read as fields", () => {
  it("labels the name and description rather than relying on placeholders", () => {
    expect(flat(page)).toContain('<label htmlFor="event-name"');
    expect(flat(page)).toContain('<label htmlFor="event-description"');
  });

  it("gives every input a visible surface", () => {
    /* Transparent inputs with muted placeholder text were indistinguishable
     * from captions -- people could not tell what was editable. A filled
     * surface with an inset ring says "type here" without the heavy outlined
     * box the rest of the sheet avoids. */
    for (const id of ["event-name", "event-date", "event-start", "event-end", "event-venue"]) {
      const field = page.slice(page.indexOf(`id="${id}"`) - 700, page.indexOf(`id="${id}"`) + 700);
      expect(field, id).toContain("bg-secondary/50");
    }
  });

  it("labels both ends of the time range", () => {
    // "Ends" used to be sr-only, so the second control was an unlabelled box
    // beside an arrow.
    const when = page.slice(page.indexOf('id="event-date"'), page.indexOf('id="event-venue"'));
    expect(flat(when)).toContain("> Starts <");
    expect(flat(when)).toContain("> Ends <");
  });

  it("asks for the venue in words, and keeps the privacy line", () => {
    expect(page).toContain('placeholder="Where is it happening?"');
    expect(page).toContain("A venue name, not a street address.");
  });
});

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

describe("the Event cover", () => {
  it("invites a photo rather than reporting its absence", () => {
    expect(cover).toContain("Add a cover");
    expect(cover).toContain("Make your Event stand out.");
    expect(cover).not.toContain("No cover yet");
  });

  it("tells a reviewer what to do about a missing cover", () => {
    /* Review may legitimately say "No cover yet" -- it is a summary, and the
     * absence is the fact being summarised. What it must not do is state that
     * without a next step, because publishing is refused without one. */
    const review = page.slice(page.indexOf("No cover yet"));
    expect(review.slice(0, 300)).toContain("Add one in Basics to publish.");
  });

  it("keeps its guidance to one line", () => {
    // The old paragraph explained crop behaviour, aspect ratio and pixel
    // dimensions before anything had been chosen.
    expect(cover).toContain("Portrait photos work best");
    expect(cover).not.toContain("Any photo works. Drag to keep faces near the centre");
  });

  it("only says drag where dragging does something", () => {
    /* The frame really is a focal positioner, so the instruction is honest --
     * but only once there is an image to position. */
    expect(cover).toContain("hasCover");
    const guidance = cover.slice(cover.indexOf("Portrait photos work best") - 400);
    expect(guidance.slice(0, 500)).toContain("hasCover");
  });

  it("still uploads through the canonical action, with no second pipeline", () => {
    // PREVIEW KEPT: the pre-upload preview is reliable, so it stays. What
    // matters is that it feeds the same server action rather than its own.
    expect(cover).toContain("uploadEventCoverAction");
    expect(cover).toContain("compressImageForUpload");
  });

  it("shows the chosen cover on the Review step", () => {
    // Prettier may wrap the arguments; assert the call, not its layout.
    expect(flat(page)).toMatch(/focalObjectPosition\(\s*cover\.focalX,\s*cover\.focalY\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Artwork and density
// ---------------------------------------------------------------------------

describe("Event artwork", () => {
  it("drops the giant monogram fallback", () => {
    /* A centred "MB" in a flat rectangle read as an unfinished placeholder --
     * the exact impression the fallback exists to avoid. */
    expect(artwork).not.toContain(">MB<");
    expect(artwork).toContain("<CalendarDays");
    expect(artwork).toContain("radial-gradient");
  });

  it("keeps the hero cinematic rather than full-screen", () => {
    // 4:5 at 390px is 488px tall: the hero filled the viewport and pushed
    // every other section below the fold.
    expect(cards).toContain('className="aspect-[5/4] w-full sm:aspect-[16/9]"');
    expect(cards).not.toContain("aspect-[4/5] w-full");
  });

  it("features one Event on a phone and two once there is room", () => {
    // Two stacked 16:9 cards consumed a whole 390px viewport before "More
    // events" appeared, so a discovery surface looked empty.
    expect(discover).toContain("const [featuredSlots, setFeaturedSlots] = useState(1);");
    expect(discover).toContain("slice(0, featuredSlots)");
    expect(discover).toContain('matchMedia("(min-width: 640px)")');
  });
});

// ---------------------------------------------------------------------------
// Header composition
// ---------------------------------------------------------------------------

describe("the Events header is compact", () => {
  it("does not give Create event a band of its own", () => {
    /* The desktop h1 is hidden on phones, so the header row contained only the
     * Create button -- an empty band that made the screen look stretched
     * before any content began. */
    expect(page).toContain('<header className="hidden md:flex');
  });

  it("keeps Create beside the tabs, labelled", () => {
    // An unlabelled orange circle beside four text tabs reads as a stray icon.
/* Create moved OUT of the tab row entirely (4K §29): it was consuming the
       slot Hosting needed at 360px, and a verb does not belong among four
       destination nouns. It is now an action above the tabs. */
    expect(page).toContain("onClick={openCreate}");
    const button = page.slice(page.indexOf("onClick={openCreate}") - 400);
    expect(button.slice(0, 700)).toContain("Create");
    // All four destinations stay in the tablist.
    for (const label of ["Home", "Discover", "Yours", "Hosting"]) {
      expect(page, label).toContain(`label: "${label}"`);
    }
  });
});
