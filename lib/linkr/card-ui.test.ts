import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const card = read("components/linkr/candidate-card.tsx");
const css = read("app/globals.css");

describe("approved Linkr candidate card composition", () => {
  it("shows every photo the projection chose, and bounds it there", () => {
    /* THE BOUND LIVES IN ONE PLACE, and the card follows it.
     *
     * This previously pinned the literal `candidate.photos.slice(0, 3)`. That
     * number was never a product decision -- it was the implementation as
     * found, and it silently discarded the fourth photo while the media
     * projection deliberately assembles up to MAX_LINKR_CARD_PHOTOS (avatar
     * plus the three showcase slots the schema allows, profile_photos.position
     * being constrained to 0..2). Somebody who filled every showcase slot
     * never saw their last photo in Linkr, and the progress bar under-reported
     * the set.
     *
     * What matters is that the card does not invent its own ceiling: it reads
     * the projection's constant. Asserting THAT survives a future change to
     * the number, which pinning a literal cannot. */
    expect(card).toContain("MAX_LINKR_CARD_PHOTOS");
    expect(card, "the card re-invented its own photo ceiling").not.toMatch(
      /photos\.slice\(0,\s*\d/
    );
    expect(card).toContain("total > 1");
    expect(card).toContain("linkr-card__progress-seg");
  });

  it("keeps tap-edge photo browsing distinct from swipe decisions", () => {
    expect(card).toContain("tapZone(event.clientX - rect.left, rect.width)");
    expect(card).toContain("linkr-card__edge--previous");
    expect(card).toContain("linkr-card__edge--next");
    expect(card).toContain("Swipe to decide");
    expect(card).toContain("Tap edges for more photos");
  });

  it("presents bio before bounded interests and no shared-group row", () => {
    expect(card.indexOf("linkr-card__bio")).toBeLessThan(card.indexOf("linkr-card__interests"));
    /* Bounded, without pinning the exact number. Four chips wrapped onto a
       second row at 390px and a third at 320px, pushing the photograph behind
       text; three fit on one line at every width the app supports. The
       contract is "a bounded taste of the person", not a specific integer. */
    expect(card).toMatch(/candidate\.interests\.slice\(0,\s*[1-4]\)/);
    expect(card).not.toMatch(/Both in|shared.group/i);
  });

  it("keeps Pass quiet and Connect orange with the approved wave hand", () => {
    expect(card).toContain("linkr-action--pass");
    expect(card).toContain("linkr-action--connect");
    expect(card).toContain("<Hand aria-hidden />");
    expect(css).toMatch(/\.linkr-action--connect[\s\S]*background: var\(--color-brand-orange\)/);
  });
});
