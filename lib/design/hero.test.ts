import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HERO_SCRIM_DEFAULT,
  heroCollapseProgress,
  heroParallaxOffset,
  heroScrim
} from "@/lib/design/hero";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * The Hero Card design system.
 *
 * The adaptive blur is the part that fails invisibly — a name that is merely
 * hard to read still renders, so nothing errors and nobody notices until a
 * user complains. Testing it as numbers is what keeps it honest.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const heroCard = stripComments(read("components/hero/hero-card.tsx"));
const profile = stripComments(read("components/friends/muddy-profile-page.tsx"));
const viewer = stripComments(read("components/content/moment-media-viewer.tsx"));

describe("adaptive blur", () => {
  it("darkens the veil over a BRIGHT image", () => {
    // White text over a pale sky is this layout's classic failure. More
    // opacity is what buys the contrast back.
    const bright = heroScrim(0.9);
    expect(bright.scrimOpacity).toBeGreaterThan(HERO_SCRIM_DEFAULT.scrimOpacity);
  });

  it("lightens the veil over a DARK image", () => {
    // A dark photo under a heavy scrim reads as a dead grey band; the picture
    // is supposed to stay visible underneath.
    const dark = heroScrim(0.05);
    expect(dark.scrimOpacity).toBeLessThan(HERO_SCRIM_DEFAULT.scrimOpacity);
  });

  it("moves blur inversely to opacity, so the two never stack into a wall", () => {
    expect(heroScrim(0.95).blurPx).toBeLessThan(heroScrim(0.05).blurPx);
  });

  it("adds a text shadow only at the extreme bright end", () => {
    expect(heroScrim(0.99).textShadow).not.toBeNull();
    expect(heroScrim(0.5).textShadow).toBeNull();
    expect(heroScrim(0.05).textShadow).toBeNull();
  });

  it("falls back to the balanced default when luminance is unknown", () => {
    // A wrong guess is worse than a sane default — a tainted canvas must not
    // produce a random veil.
    expect(heroScrim(null)).toEqual(HERO_SCRIM_DEFAULT);
    expect(heroScrim(Number.NaN)).toEqual(HERO_SCRIM_DEFAULT);
  });

  it("never becomes an opaque overlay", () => {
    // The image must stay visible through the blur at every brightness; a
    // fully opaque scrim would make this a card again.
    for (const luminance of [0, 0.25, 0.5, 0.75, 1]) {
      expect(heroScrim(luminance).scrimOpacity).toBeLessThan(0.7);
    }
  });

  it("keeps enough tint for readable text at every brightness", () => {
    for (const luminance of [0, 0.25, 0.5, 0.75, 1]) {
      expect(heroScrim(luminance).scrimOpacity).toBeGreaterThan(0.15);
    }
  });

  it("is continuous, so a mixed gallery does not jump between presets", () => {
    // Adjacent luminances must not produce visibly different veils.
    for (let luminance = 0; luminance < 1; luminance += 0.05) {
      const step = Math.abs(heroScrim(luminance).scrimOpacity - heroScrim(luminance + 0.05).scrimOpacity);
      expect(step).toBeLessThan(0.06);
    }
  });

  it("clamps out-of-range input rather than extrapolating", () => {
    expect(heroScrim(-1)).toEqual(heroScrim(0));
    expect(heroScrim(2)).toEqual(heroScrim(1));
  });
});

describe("motion", () => {
  it("drifts the image slower than the scroll", () => {
    expect(heroParallaxOffset(100)).toBeLessThan(100);
    expect(heroParallaxOffset(100)).toBeGreaterThan(0);
  });

  it("caps the drift so the image never leaves its frame", () => {
    expect(heroParallaxOffset(100_000)).toBe(64);
  });

  it("is completely still under reduced motion", () => {
    expect(heroParallaxOffset(500, { reducedMotion: true })).toBe(0);
  });

  it("reports collapse from 0 to 1 and never beyond", () => {
    expect(heroCollapseProgress(0, 400)).toBe(0);
    expect(heroCollapseProgress(100_000, 400)).toBe(1);
    expect(heroCollapseProgress(120, 400)).toBeGreaterThan(0);
  });

  it("does not divide by a zero-height hero", () => {
    expect(heroCollapseProgress(100, 0)).toBe(0);
  });
});

describe("the Hero component is reusable, not screen-specific", () => {
  it("takes content as slots rather than knowing about profiles", () => {
    expect(heroCard).toContain("media:");
    expect(heroCard).toContain("identity:");
    expect(heroCard).toContain("action?:");
  });

  it("contains no Profile, Moment or Muddy vocabulary", () => {
    // The moment this component knows what it is showing, the next screen
    // needs a second copy of it.
    for (const word of ["muddy", "moment", "profile", "friend"]) {
      expect(heroCard.toLowerCase(), `HeroCard must not reference "${word}"`).not.toContain(word);
    }
  });

  it("derives its scrim from the shared pure module", () => {
    expect(heroCard).toContain('from "@/lib/design/hero"');
  });

  it("builds the blur as stacked masked bands, not one hard-edged layer", () => {
    expect(heroCard).toContain("maskImage");
    expect(heroCard).toContain("backdropFilter");
  });

  it("carries the warm brand wash rather than neutral glassmorphism", () => {
    expect(heroCard).toContain("249_115_22");
  });

  it("respects reduced motion for the load transition", () => {
    expect(heroCard).toContain("reducedMotion");
  });
});

describe("adoption", () => {
  it("the profile hero uses the shared system", () => {
    expect(profile).toContain("<HeroCard");
    expect(profile).toContain("<HeroIdentity");
  });

  it("the profile no longer stacks equally weighted actions", () => {
    // The old layout was three same-weight buttons in a row. Exactly one
    // primary now dominates.
    //
    // Counted PER BRANCH: the Muddy and non-Muddy states are mutually
    // exclusive, so the file legitimately contains two primaries while any
    // single render shows one. Counting the whole block would be asserting
    // something that was never true.
    const heroBlock = profile.slice(profile.indexOf("<HeroCard"), profile.indexOf("waveFeedback ?"));
    // Two primaries exist in the file — one per mutually exclusive branch
    // (Message for a Muddy, Become Muddies for a stranger) — so exactly one
    // ever renders. More than two would mean a branch grew a second.
    expect((heroBlock.match(/variant="primary"/g) ?? []).length).toBe(2);
    expect(heroBlock).toContain("isMuddy ? (");
    // The Muddy branch's secondaries are icon-only, so nothing competes with
    // Message: they carry an aria-label instead of a visible text label.
    /* The plan action is icon-only and named by its aria-label. The literal
       was pinned as `aria-label="Create a plan"`, which broke when the label
       gained the person's name -- "Create a plan with Ama" -- while the
       property this asserts (icon-only, so it carries an accessible name
       rather than visible text) held throughout. */
    expect(heroBlock).toMatch(/aria-label=\{?[`"]Create a plan/);
    expect(heroBlock).toContain('aria-label={waveSent ? "Wave sent" : "Wave"}');
  });

  it("moves Block and Report out of the hero", () => {
    // Safety controls should not sit beside "Become Muddies" carrying equal weight.
    const heroBlock = profile.slice(profile.indexOf("<HeroCard"), profile.indexOf("waveFeedback ?"));
    expect(heroBlock).not.toContain("blockPerson");
    expect(heroBlock).not.toContain("setReportOpen");
  });

  it("the Moments viewer now shows caption, author and time", () => {
    // It previously rendered media and nothing else.
    expect(viewer).toContain("active.caption");
    expect(viewer).toContain("active.authorName");
    expect(viewer).toContain("formatRelativeTime(active.createdAt)");
  });

  it("hides the Moment identity layer while zoomed or dragging", () => {
    expect(viewer).toContain("!zoomed && !isText");
    expect(viewer).toContain("opacity: dragging ? 0 : 1");
  });

  it("reuses the canonical avatar and membership treatment in the viewer", () => {
    expect(viewer).toContain("<UserAvatar");
    expect(viewer).not.toContain("publicMembershipTier(active.authorPlan)");
  });
});
