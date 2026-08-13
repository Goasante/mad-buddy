import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { SMART_CARD_IDS, SMART_CARD_PRIORITY, type SmartCardId } from "@/lib/smart-card/smart-card";

/**
 * The compact Journey hero.
 *
 * The hero was compacted to make room for ranked Events on Home. These tests
 * exist to stop that compaction becoming a regression: the states that carry
 * safety or live Journey information must still take the room they need, and
 * nothing that was on the card may have been dropped to save height.
 *
 * Assertions avoid source slicing and literal newlines -- a previous round of
 * tests in this codebase passed locally and failed on a fresh checkout purely
 * because of CRLF. Everything here matches on single-line substrings or on
 * real exported values.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const component = stripComments(read("components/journey/smart-card.tsx"));

/**
 * The card ids the component treats as prominent, parsed from the source so
 * the test cannot drift from the implementation's own list.
 */
function prominentIds(): SmartCardId[] {
  const match = component.match(/PROMINENT_CARD_IDS = new Set<SmartCard\["id"\]>\(\[([^\]]*)\]\)/);
  if (!match) return [];
  return [...match[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1] as SmartCardId);
}

describe("which states are allowed to take space", () => {
  const prominent = prominentIds();

  it("treats Safe Arrival and the active Journey as prominent", () => {
    expect(prominent).toContain("safe_arrival");
    expect(prominent).toContain("journey");
  });

  it("keeps every routine state compact", () => {
    // The whole point of the change: these are the cards that were wasting
    // vertical space on Home.
    for (const id of ["membership", "buddy_progress", "suggestions", "birthday", "weekend_plans"] as const) {
      expect(prominent, `${id} must stay compact`).not.toContain(id);
    }
  });

  it("names only real card ids", () => {
    // A typo here would silently make a state compact forever.
    for (const id of prominent) {
      expect(SMART_CARD_IDS, `${id} is not a canonical card id`).toContain(id);
    }
  });

  it("fails safe for a card id nobody has classified yet", () => {
    // Set membership means an unknown id is simply absent -> compact. A new
    // card can never quietly claim hero space by existing.
    const unknown = "not_a_real_card" as SmartCardId;
    expect(prominent).not.toContain(unknown);
    expect(component).toContain("const prominent = PROMINENT_CARD_IDS.has(card.id)");
  });

  it("leaves Safe Arrival the highest-priority card it already was", () => {
    // Compaction must not have reordered which card wins Home.
    expect(SMART_CARD_IDS[0]).toBe("safe_arrival");
    expect(SMART_CARD_PRIORITY.safe_arrival).toBeLessThan(SMART_CARD_PRIORITY.membership);
    expect(SMART_CARD_PRIORITY.safe_arrival).toBeLessThan(SMART_CARD_PRIORITY.suggestions);
  });
});

describe("nothing was removed to save height", () => {
  it("still renders title, subtitle and CTA in every state", () => {
    for (const field of ["{card.title}", "{card.subtitle}", "{card.cta}"]) {
      expect(component, field).toContain(field);
    }
  });

  it("still renders progress when a card carries it", () => {
    expect(component).toContain("card.progress ? (");
    expect(component).toContain("{card.progress.percent}% Complete");
    expect(component).toContain("{card.progress.label}");
    // The meter itself survives; the compact layout tightens spacing only.
    expect(component).toContain("scaleX(${animatedPercent / 100})");
  });

  it("keeps the artwork and the acknowledgement behaviour", () => {
    expect(component).toContain("ILLUSTRATIONS[card.illustration]");
    expect(component).toContain("acknowledgeSmartCardAction(card.id)");
  });
});

describe("the card can still grow", () => {
  it("puts no fixed or maximum height on the card itself", () => {
    // A hard height is what would clip a long Safe Arrival subtitle. The
    // illustration inside is legitimately sized; this checks the card.
    const rootClass = component.slice(
      component.indexOf("focus-ring safe-motion group"),
      component.indexOf("</Link>")
    );
    const openingTag = rootClass.slice(0, rootClass.indexOf("`}"));
    expect(openingTag).not.toMatch(/\bh-\[/);
    expect(openingTag).not.toMatch(/\bmax-h-/);
  });

  it("never clips or scrolls its own content", () => {
    expect(component).not.toContain("overflow-y-auto");
    expect(component).not.toContain("truncate");
    expect(component).not.toContain("line-clamp");
  });

  it("varies only spacing and type scale between the two modes", () => {
    // One shell whatever the card: same radius, same gradient.
    expect(component.match(/rounded-\[1\.75rem\]/g)?.length).toBe(1);
    expect(component.match(/linear-gradient\(118deg/g)?.length).toBe(1);
    // And the compact mode really is tighter than the prominent one.
    expect(component).toContain('prominent ? "px-5 pb-5 pt-5" : "px-5 pb-4 pt-4"');
  });
});

describe("decoration never competes with safety", () => {
  it("renders no glare on prominent states", () => {
    // Safety state outranks visual effect: a sweep of light crossing a Safe
    // Arrival card is decoration on top of information someone may need to
    // read quickly.
    // The guard now also excludes the card that renders the prism instead,
    // so this asserts the INVARIANT -- a prominent card reaches no animated
    // background at all -- rather than one literal spelling of the condition.
    const guardIndex = component.indexOf("prominent");
    const glareIndex = component.indexOf("<GlareHover");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(glareIndex).toBeGreaterThan(guardIndex);
    // Whatever the guard says, `prominent` must gate the glare...
    expect(component).toMatch(/\{prominent[^}]*\? null : \(/);
    // ...and must gate the prism too, so neither can reach a safety card.
    expect(component).toContain('const PRISM_CARD_IDS = new Set<SmartCard["id"]>(["suggestions"]);');
  });

  it("keeps the glare decorative and non-interactive where it does render", () => {
    expect(component).toContain("pointer-events-none");
  });
});

describe("Home still works around the hero", () => {
  const home = stripComments(read("components/dashboard/dashboard-page.tsx"));

  it("renders exactly one hero, never a list", () => {
    expect(home).toContain("<SmartCardHero card={smartCard} />");
    expect(home).not.toContain("smartCards");
  });

  it("keeps ranked Events beneath the hero rather than replacing it", () => {
    const heroIndex = home.indexOf("<SmartCardHero");
    const eventsIndex = home.indexOf("<TopEventsHome");
    expect(heroIndex).toBeGreaterThan(-1);
    expect(eventsIndex).toBeGreaterThan(heroIndex);
  });

  it("does not bury Safe Arrival behind discovery", () => {
    // Safe Arrival can be the hero itself (highest priority) and also has its
    // own Home section. Neither was removed by this change.
    expect(home).toContain("home-safe-arrival-heading");
  });
});
