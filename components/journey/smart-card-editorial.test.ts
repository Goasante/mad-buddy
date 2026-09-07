import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homeCardBBackground } from "@/lib/visuals/registry";

const source = readFileSync(new URL("./smart-card-v2.tsx", import.meta.url), "utf8");

/**
 * Smart Card presentation, under the fixed two-background system.
 *
 * This file used to assert the opposite: that Card B cropped one of six scenes
 * out of an editorial atlas by card family, and preferred a person's photo when
 * the card had one. Both were ways of choosing artwork per state, and the
 * founder's direction replaced them with one static ground per card.
 *
 * What survives unchanged is the part that was never about the atlas -- the
 * card must not infer anything about a person, and the authorized click-time
 * conversation intent must stay intact.
 */
describe("Smart Card presentation", () => {
  it("always uses the one registered Card B ground", () => {
    expect(homeCardBBackground().path).toBe("/visuals/home-cards/card-b-background.png");
    expect(source).toContain("homeCardBBackground().path");
  });

  it("never selects a background by state, family, or media", () => {
    /* The atlas and every helper that indexed into it are gone. A sprite-sheet
       offset is the tell: `backgroundSize` cropped one tile of six. */
    for (const gone of [
      "smartCardEditorialAtlas",
      "EDITORIAL_ATLAS",
      'backgroundSize: "300% 200%"',
      "fallbackAtlasPosition",
      "mediaPosition",
      "hasTruthfulMedia",
      "card.media!.url"
    ]) {
      expect(source, `${gone} must not survive`).not.toContain(gone);
    }
  });

  it("keeps Safe Arrival on the same ground, changing only its treatment", () => {
    /* Safety may look calmer -- it keeps its maroon scrim -- but it does not get
       different artwork. One card, one background, whatever the state. */
    expect(source).toContain("safety");
    expect(source).not.toMatch(/safety \?\s*"\/visuals|safety \? HOME_CARD/);
  });

  it("does not infer gender from names", () => {
    expect(source).toContain("a display name is never a gender authority");
  });

  it("preserves the authorized click-time conversation intent", () => {
    expect(source).toContain("openDirectConversationAction(intent.targetUserId)");
    expect(source).toContain("conversationHref(result.conversationId)");
    expect(source).toContain("card.primaryIntent");
  });
});
