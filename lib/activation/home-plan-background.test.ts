import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { homeCardABackground, homeCardBBackground } from "@/lib/visuals/registry";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
/* The mobile bottom bar moved to its own module so the Capacitor SPA can
   render the SAME navigation. This assertion COUNTS nav slots, so it reads
   only the file that now owns them -- concatenating would double-count. */
const shell = read("components/app-shell/mobile-nav.tsx");

/* CODE, NOT COMMENTARY. These assertions are about what the components DO, and
   both files explain in prose why the old atlas and the old hardcoded path were
   removed -- so matching raw source would fail on the explanation of the very
   thing being asserted. */
const activation = stripComments(read("components/activation/activation-card.tsx"));
const smartCard = stripComments(read("components/journey/smart-card-v2.tsx"));

describe("quick Home polish follow-up", () => {
  it("moves mobile nav graphics another step down without increasing the bar", () => {
    // Three slots now, not two: the tab renderer gained a disabled branch for
    // destinations that exist on web but not in the native app (Linkr, UpFor).
    // The point of the assertion is unchanged -- every slot uses the SAME
    // spacing, so the bar cannot grow.
    expect(shell.match(/min-w-0 flex-1 pb-0 pt-4/g) ?? []).toHaveLength(3);
    expect(shell).not.toContain('className="min-w-0 flex-1 pb-1 pt-3"');
  });
});

/**
 * HOME'S TWO FIXED CARD BACKGROUNDS.
 *
 * This file used to assert that Card A wired `/home/open-your-plan-bg.webp` --
 * a hardcoded path, outside the visual registry, and applied to exactly ONE
 * activation state. Every other Card A state had no artwork at all, and a real
 * phone showed the result: the first card visibly carried older design.
 *
 * Home now uses two fixed grounds. Card A always wears one, Card B always wears
 * the other, and neither is ever chosen by state. Only the content layer varies
 * -- eyebrow, headline, subtitle, metadata, actions -- plus the scrim strength
 * needed to keep that content legible over the art.
 */
describe("Card A and Card B each have exactly one background", () => {
  it("routes both through the visual registry, never a hardcoded path", () => {
    expect(activation).toContain("homeCardABackground()");
    expect(smartCard).toContain("homeCardBBackground()");

    /* The old hardcoded path is gone from the component entirely. */
    expect(activation).not.toContain("/home/open-your-plan-bg.webp");
  });

  it("gives each card its OWN ground, and never the other's", () => {
    expect(homeCardABackground().path).toBe("/visuals/home-cards/card-a-background.png");
    expect(homeCardBBackground().path).toBe("/visuals/home-cards/card-b-background.png");
    expect(homeCardABackground().path).not.toBe(homeCardBBackground().path);

    expect(activation).not.toContain("homeCardBBackground");
    expect(smartCard).not.toContain("homeCardABackground");
  });

  /**
   * THE RULE THAT MATTERS MOST: the background is not a function of state.
   * Card B previously cropped one of six scenes out of an atlas by card family,
   * and preferred a person's photo when the card had one. Both are gone, and
   * the helpers that implemented them are gone with them.
   */
  it("never selects artwork by card state", () => {
    for (const gone of [
      "fallbackAtlasPosition",
      "mediaPosition",
      "EDITORIAL_ATLAS",
      "backgroundPosition",
      "UPFOR_CARD_IDS",
      "LINKR_CARD_IDS",
      "PLAN_CARD_IDS",
      "BIRTHDAY_CARD_IDS",
      "REQUEST_CARD_IDS"
    ]) {
      expect(smartCard, `${gone} must not survive`).not.toContain(gone);
    }
  });

  it("uses a resolver that cannot be handed a state", () => {
    /* Both resolvers take no arguments on purpose: one that accepted a card or
       a state would be an open invitation to make the ground dynamic again. */
    expect(homeCardABackground.length).toBe(0);
    expect(homeCardBBackground.length).toBe(0);
  });

  it("shows no photography or motion behind either card", () => {
    /* Card B used to layer a real person's photo over the ground. Nothing
       reintroduces user or Event media as a Card background. */
    expect(smartCard).not.toContain("card.media!.url");
    /* Scoped to the BACKGROUND layer. Card A still animates its foreground Glow
       brand mark -- a slow opacity breath that respects reduced motion -- and
       that is a content-layer affordance, not scene art behind the words. */
    for (const source of [activation, smartCard]) {
      expect(source).not.toMatch(/<video|autoPlay/);
    }
    expect(smartCard).not.toMatch(/animate-\[/);
  });

  it("keeps a fixed scrim so the content stays legible over the art", () => {
    /* The scrim is part of the fixed treatment, not per-state decoration: it is
       what makes one ground work for every headline the card can render. */
    expect(activation).toContain("linear-gradient(90deg,rgba(18,8,6,0.94)");
    expect(smartCard).toContain("linear-gradient(90deg,rgba(7,7,6,0.98)");
  });
});
