import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE PUBLIC STORY MUST MATCH THE PRODUCT.
 *
 * MB-GOD-059. The landing page named four capabilities — Glow, Wave, Plan,
 * Meet — and never mentioned Linkr or UpFor, which are two of the five
 * bottom-nav destinations and the entire future paid tier. A visitor met both
 * for the first time INSIDE the product, and later met a Welcome Access clock
 * on features the public story had never introduced.
 *
 * Worse than an omission, it was a factual error. The landing page asserted in
 * four places that only approved Muddies can see you nearby. Linkr makes that
 * untrue: it shows you to people you have not met, for as long as a session is
 * on. The About page had already been corrected for exactly this ("Two ways
 * people find each other"); the landing page was left behind, so the honest
 * description of the product was the one you saw only after signing up.
 *
 * The repair was COMPRESSION, not addition — the page was already 9.56 screens
 * on a phone. Duplicated material was removed (a second step list restating
 * how-it-works, the privacy points rendered three times, a second call to
 * action one screen above the real one), and the reclaimed space introduces
 * Linkr and UpFor. Measured on a real 390x844 viewport: 9.56 -> 8.66 screens,
 * and on desktop 7.17 -> 6.63. The page tells MORE of the story in LESS space.
 */

const ROOT = join(__dirname, "..", "..");
const landingSource = readFileSync(join(ROOT, "components/landing/landing-page.tsx"), "utf8");

/**
 * The source with comments stripped.
 *
 * The removals below are DOCUMENTED IN COMMENTS at the sites they were removed
 * from — including the exact sentences that were deleted — so a test asserting
 * on the raw file finds them and fails on a file that is correct. Two guards in
 * this codebase have already hit that trap (the mobile-shell 100vh scan and the
 * RLS widening check); the fix is always to assert against CODE, not prose.
 */
const landing = landingSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const about = readFileSync(join(ROOT, "components/legal/about-page.tsx"), "utf8");

describe("the landing page introduces what the product actually has", () => {
  it("names Linkr in BOTH places it belongs", () => {
    /* Two distinct jobs, and a bare `toContain("Linkr")` proves neither:
       mutation testing showed the feature card could be renamed to "Discover"
       with the assertion still passing, because the discovery card also says
       "Linkr".

         - the discovery card, which explains WHO can see you
         - the feature grid, which lists it as a capability alongside the rest

       Naming each SITE is what makes losing either one fail. An occurrence
       COUNT was tried first and was the wrong instrument: it read 3 against a
       file whose code contains exactly 2 (the rest were the comments explaining
       the change), so it failed on a correct page. */
    expect(landing, "the discovery card no longer names Linkr").toContain("With Linkr");
    expect(landing, "the feature grid no longer lists Linkr").toContain('title: "Linkr"');
  });

  it("names UpFor as a capability, not just in passing", () => {
    expect(landing).toContain('title: "UpFor"');
    expect(landing).toContain("upForPitch");
  });

  it("frames discovery the same way About does", () => {
    /* Both pages must give the visitor the same model of who can see them.
       This is the assertion that catches the two drifting apart again. */
    for (const page of [landing, about]) {
      expect(page).toContain("Two ways people find each other");
      expect(page).toContain("With your Muddies");
      expect(page).toContain("With Linkr");
    }
  });

  it("bounds the Linkr exposure rather than glossing it", () => {
    /* A landing page that mentioned Linkr without saying WHEN it exposes you
       would be a worse lie than not mentioning it: it would imply the exposure
       is permanent, or hide that it exists at all. About commits to "only
       while you have a session switched on"; landing must commit too. */
    expect(landing).toMatch(/only while you keep a session switched on|only for as long as you keep a session/i);
  });
});

describe("the corrected claims do not come back", () => {
  it("no longer says only approved Muddies can appear nearby", () => {
    // THE UNTRUE SENTENCE. Linkr shows non-Muddies.
    expect(landing).not.toContain("Only Muddies you both approve can appear nearby");
  });

  it("no longer says only approved friends can see when you are nearby", () => {
    expect(landing).not.toContain("Only approved friends can see when you");
  });

  it("still promises no exact location, in both discovery branches", () => {
    /* The locked product principle is unchanged and must survive the rewrite:
       introducing Linkr must not quietly weaken the privacy guarantee. Both
       branches state the same rough-proximity limit. */
    expect(landing).toContain("Close, Near or Far");
    expect(landing).toMatch(/never a map, a pin or a distance/i);
    expect(landing).toMatch(/no exact location is ever shared/i);
  });

  it("keeps mutual approval as the rule for Muddies", () => {
    // Narrowed, not deleted: approval still governs the Muddies relationship.
    expect(landing).toContain("Muddies see each other only after you both approve");
  });
});

describe("the page did not simply get longer", () => {
  it("does not render the same step list twice", () => {
    /* `momentSteps` was Glow -> Wave -> Plan -> Meet, a near-copy of
       `howItWorksSteps` two sections above. Its removal is what paid for the
       new content. */
    expect(landingSource).not.toContain("const momentSteps = [");
  });

  it("does not render the privacy points three times", () => {
    // `momentTrustPoints` was rendered twice inside one section, and a third
    // time by the privacy section that follows it.
    expect(landingSource).not.toContain("const momentTrustPoints = [");
  });

  it("has one call to action, not one a screen above the other", () => {
    expect(landing).not.toContain("Ready to meet naturally?");
  });
});
