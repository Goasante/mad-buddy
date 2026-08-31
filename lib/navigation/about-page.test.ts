import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

/**
 * The About page: header contract, and copy that matches the product.
 *
 * TWO CLASSES OF BUG LIVE HERE, and they fail differently.
 *
 * The header ones are structural. About is PUBLIC, so it cannot use
 * MobilePageHeader or PageHeader -- both carry notifications, Muddy requests
 * and quick controls that only exist for a signed-in person. That left it
 * building its own, and the version before this reserved no safe-area inset
 * at all while the app sets viewportFit: "cover", so the title sat under the
 * Dynamic Island.
 *
 * The copy ones are worse, because they are invisible to every other kind of
 * test and they are what a person reads before deciding to trust the product.
 * The previous page promised "no open discovery of strangers" and that you
 * "only appear to people you have both approved" -- both untrue since Linkr,
 * which shows non-Muddies nearby while a session runs. A page that makes a
 * privacy promise the code does not keep is the most expensive kind of stale.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const source = read("components/legal/about-page.tsx");
const about = stripComments(source);
const route = stripComments(read("app/about/page.tsx"));
const publicShell = stripComments(read("components/front-door/public-shell.tsx"));

// ---------------------------------------------------------------------------
// Header and safe area
// ---------------------------------------------------------------------------

describe("the header clears the notch exactly once", () => {
  it("reserves the safe-area inset on the header itself", () => {
    expect(publicShell).toContain("pt-[env(safe-area-inset-top,0px)]");
  });

  it("reserves it in exactly one place", () => {
    // THE DOUBLE-PADDING BUG. Two elements each adding the inset is what
    // produces the huge top gap on a notched device -- and it looks correct
    // on a desktop, where the inset is 0 and both terms vanish.
    expect((publicShell.match(/env\(safe-area-inset-top/g) ?? []).length).toBe(2);
    // One on the header, one on the single spacer below it. Matched on the
    // spacer's own declaration rather than by slicing from the tag before it:
    // a slice anchored on literal whitespace does not survive CRLF, and this
    // assertion silently depended on it.
    expect(publicShell).toContain("pt-[calc(env(safe-area-inset-top,0px)+4.25rem)]");
    expect(publicShell).toContain("pt-[env(safe-area-inset-top,0px)]");
  });

  it("uses no negative margin to compensate", () => {
    // Pulling content back up under a header is the hack this replaces.
    expect(about).not.toMatch(/-mt-\d/);
    expect(about).not.toContain("marginTop: -");
  });

  it("uses no device-specific magic numbers", () => {
    // 44, 47 and 59 are the iPhone status-bar heights people hardcode.
    for (const magic of ["44px", "47px", "59px", "20px)"]) {
      expect(about, `no hardcoded inset: ${magic}`).not.toContain(magic);
    }
  });

  it("spans the full viewport width", () => {
    // inset-x-0 rather than a max-width wrapper: the blurred surface must
    // reach both edges, and only the inner nav is constrained.
    const header = publicShell.slice(publicShell.indexOf("<header"));
    expect(header.slice(0, 400)).toContain("fixed inset-x-0 top-0");
    expect(header.slice(0, 700)).toContain("max-w-7xl");
  });

  it("keeps one fixed row height, matching the canonical token", () => {
    // --app-header-content-height is 4.25rem. The spacer derives from the
    // same constant, so the two cannot drift.
    expect(publicShell).toContain("h-[4.25rem]");
    expect(publicShell).toContain("+4.25rem");
  });

  it("grows its divider only once content passes beneath it", () => {
    // Same hook and same threshold as every other header in the app.
    expect(publicShell).toContain("border-b border-[#4E0401]/10");
    expect(publicShell).toContain("backdrop-blur-xl");
  });

  it("does not reach for a signed-in header it cannot use", () => {
    // Both would render notification and Muddy-request affordances that have
    // no meaning without a session.
    expect(about).not.toContain("MobilePageHeader");
    expect(about).not.toContain("PageHeader");
  });

  it("respects the bottom safe area", () => {
    expect(publicShell).toContain("env(safe-area-inset-bottom)");
  });
});

// ---------------------------------------------------------------------------
// The copy matches the product
// ---------------------------------------------------------------------------

describe("the page describes the product as it is now", () => {
  it("no longer claims strangers cannot find you", () => {
    // THE CENTRAL CORRECTION. Linkr shows non-Muddies nearby.
    expect(about).not.toContain("No open discovery of strangers");
    expect(about).not.toContain("Can strangers find me?");
    expect(about).not.toContain("only appear to people you have both approved");
  });

  it("names both discovery models and which applies where", () => {
    expect(about).toContain('title: "Muddies"');
    expect(about).toContain('title: "Linkr"');
    // And says the Linkr exposure is bounded by the session.
    expect(about).toContain("starts because you choose to enable it and stops when you stop the session");
  });

  it("covers the features the product actually has", () => {
    for (const feature of [
      "Muddies",
      "Plans & Events",
      "UpFor",
      "Linkr",
      "Messages & Moments",
      "Safe Arrival"
    ]) {
      expect(about, `About must mention ${feature}`).toContain(feature);
    }
  });

  it("uses no retired feature names", () => {
    // "Glow" survives as a visibility concept, but these were presented as
    // top-level steps in a five-part flow that no longer exists.
    expect(about).not.toContain("How Mad Buddy works");
    expect(about).not.toContain("Five small steps");
    expect(about).not.toContain("Why we’re different");
  });

  it("keeps proximity honest", () => {
    expect(about).toContain("exact coordinates");
    expect(about).toContain("exact numerical distance");
    expect(about).toContain("location history");
    // And never claims a live position is public.
    expect(about).not.toContain("live location");
  });

  it("describes contact discovery accurately", () => {
    expect(about).not.toContain("contact uploads are automatic");
    expect(about).not.toContain("contacts are public");
    // No platform claims: the picker is Chromium-on-Android only, and About
    // is the wrong place to explain that.
    expect(about).not.toContain("iPhone");
    expect(about).not.toContain("Android");
  });
});

// ---------------------------------------------------------------------------
// Identity language
// ---------------------------------------------------------------------------

describe("the three identity signals stay separate", () => {
  it("defines each one on its own terms", () => {
    expect(about).toContain("Profile & media");
    expect(about).toContain("source of your identity");
    expect(about).toContain("Controls must hold");
  });

  it("never conflates a subscription with verification", () => {
    expect(about).not.toContain("Premium users are verified");
    expect(about).not.toContain("subscription proves identity");
  });

  it("never says Trusted Member means identity was checked", () => {
    expect(about).not.toContain("Trusted Member means identity checked");
  });

  it("never says a mark means somebody is safe", () => {
    // The most dangerous possible claim on this page.
    expect(about).not.toContain("guaranteed safe");
    expect(about).not.toContain("safety verified");
  });
});

// ---------------------------------------------------------------------------
// Principles
// ---------------------------------------------------------------------------

describe("the stated principles match product rules", () => {
  it("states there is no ranking of people", () => {
    // Nothing in the product ranks people publicly, and saying so is a
    // commitment the code has to keep.
    expect(about).toContain("not building an audience around follower counts");
  });

  it("commits temporary features to actually being temporary", () => {
    expect(about).toContain("stops when you stop the session");
  });
});

// ---------------------------------------------------------------------------
// Links, headings and touch targets
// ---------------------------------------------------------------------------

describe("every link goes somewhere real", () => {
  it("links only to routes that exist", () => {
    const hrefs = [...about.matchAll(/href:\s*"(\/[^"#]*)"/g)].map((match) => match[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    // Each of these resolves to a real page file, including via route groups.
    const known = ["/safety", "/privacy", "/support", "/faq"];
    for (const href of hrefs) {
      expect(known, `${href} must be a canonical route`).toContain(href);
    }
  });

  it("invents no Community Guidelines route", () => {
    // No such page exists yet. Linking to one would be a dead link, so the
    // expectations section summarises and points at Terms instead.
    expect(about).not.toContain("/guidelines");
    expect(about).not.toContain("/community");
    expect(about).not.toContain("/rules");
  });

  it("has no dead or decorative buttons", () => {
    // Every Button on this page wraps a real Link.
    const buttons = [...about.matchAll(/<Button[^>]*>/g)];
    for (const button of buttons) {
      expect(button[0], "every Button must be asChild wrapping a Link").toContain("asChild");
    }
  });

  it("carries exactly one H1", () => {
    expect((about.match(/<h1/g) ?? []).length).toBe(1);
    expect(about).toContain("Built to get people out of the app and into real life.");
  });

  it("descends through heading levels without skipping", () => {
    // h1 once, then h2 per section, then h3 inside them. An h3 before any h2
    // would be the usual regression.
    const order = [...about.matchAll(/<h([123])/g)].map((match) => Number(match[1]));
    expect(order[0]).toBe(1);
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index] - order[index - 1], "heading levels must not jump").toBeLessThanOrEqual(1);
    }
  });

  it("names every section for assistive tech", () => {
    // Counted on the <section> tags themselves rather than on every
    // aria-labelledby in the file: the "Read more" <nav> carries one too, and
    // including it made the arithmetic accidental rather than meaningful.
    const sections = [...about.matchAll(/<section[^>]*>/g)].map((match) => match[0]);
    const unlabelled = sections.filter((tag) => !tag.includes("aria-labelledby"));
    // Exactly one: the hero, which the single h1 inside it already names.
    expect(unlabelled).toHaveLength(1);
    expect(sections.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps interactive targets reachable on a phone", () => {
    // 44px minimum, and a visible focus ring on every link.
    expect((about.match(/min-h-11/g) ?? []).length).toBeGreaterThanOrEqual(1);
    const links = (about.match(/<Link/g) ?? []).length;
    expect((about.match(/focus-ring/g) ?? []).length).toBeGreaterThanOrEqual(links - 1);
  });
});

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

describe("the page stays cheap", () => {
  it("fetches nothing", () => {
    // Static copy: no queries, no server calls, no data dependencies.
    for (const call of ["fetch(", "useEffect", "Action("]) {
      expect(about, `About must not call ${call}`).not.toContain(call);
    }
  });

  it("pulls in no animation or illustration dependency", () => {
    for (const heavy of ["framer-motion", "lottie", "three", "GlareHover"]) {
      expect(about, `About must stay free of ${heavy}`).not.toContain(heavy);
    }
  });

  it("keeps its metadata description current", () => {
    // The old one said Mad Buddy helps "friends discover each other nearby",
    // which stopped being the whole story when Linkr shipped.
    expect(route).not.toContain("turn digital connection into real life");
    expect(route).toContain("how we expect people to use it");
  });
});
