import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JOURNEY_STAGE_THRESHOLDS,
  isStagedJourneyCard,
  journeyStageForPercent,
  smartCardProgress
} from "@/lib/smart-card/smart-card";

describe("journey stage thresholds", () => {
  it("selects early below 40", () => {
    for (const percent of [0, 1, 20, 39]) {
      expect(journeyStageForPercent(percent)).toBe("early");
    }
  });

  it("selects progressing from 40 to 69", () => {
    for (const percent of [40, 55, 69]) {
      expect(journeyStageForPercent(percent)).toBe("progressing");
    }
  });

  it("selects advanced from 70 up", () => {
    for (const percent of [70, 85, 99, 100]) {
      expect(journeyStageForPercent(percent)).toBe("advanced");
    }
  });

  // The boundaries are the product rule, so they are asserted as transitions
  // rather than as points: 39->40 and 69->70 must each change the stage, and
  // the value just below each threshold must NOT already have changed.
  it("transitions exactly at 40 and 70", () => {
    expect(journeyStageForPercent(39)).not.toBe(journeyStageForPercent(40));
    expect(journeyStageForPercent(69)).not.toBe(journeyStageForPercent(70));
    expect(journeyStageForPercent(JOURNEY_STAGE_THRESHOLDS.progressing)).toBe("progressing");
    expect(journeyStageForPercent(JOURNEY_STAGE_THRESHOLDS.advanced)).toBe("advanced");
  });

  it("degrades a non-finite percent to the quietest stage, never the loudest", () => {
    expect(journeyStageForPercent(Number.NaN)).toBe("early");
  });

  it("derives the stage from the same percent the meter shows", () => {
    // No second source of truth: the stage must follow completed/total via
    // smartCardProgress, so a card can never show "70% Complete" while
    // rendering the progressing treatment.
    const progress = smartCardProgress(7, 10, "3 steps remaining");
    expect(progress.percent).toBe(70);
    expect(journeyStageForPercent(progress.percent)).toBe("advanced");
  });
});

describe("staged journey card scoping", () => {
  it("stages only the journey card", () => {
    expect(isStagedJourneyCard("journey")).toBe(true);
  });

  it("leaves the earned completion state out of the stage ladder", () => {
    // journey_complete is a separate reward card with its own copy and
    // artwork. Folding it into "advanced" would overwrite an earned state
    // with a progress state.
    expect(isStagedJourneyCard("journey_complete")).toBe(false);
  });

  it("does not stage unrelated cards", () => {
    for (const id of ["safe_arrival", "suggestions", "birthday", "membership"] as const) {
      expect(isStagedJourneyCard(id)).toBe(false);
    }
  });
});

describe("journey visual identity is independent of motion", () => {
  const source = readFileSync(join(process.cwd(), "components/journey/smart-card.tsx"), "utf8");

  it("does not gate prism identity on reduced motion", () => {
    // The defect this replaced: `showPrism = PRISM_CARD_IDS.has(id) &&
    // !reducedMotion` demoted an advanced card to the ordinary gradient for
    // anyone preferring reduced motion. Identity must not consult motion.
    const identity = source.match(/const showPrism = .*/)?.[0] ?? "";
    expect(identity).not.toContain("reducedMotion");
  });

  it("gates only the animation on reduced motion", () => {
    const animated = source.match(/const prismAnimated = .*/)?.[0] ?? "";
    expect(animated).toContain("reducedMotion");
  });

  it("renders a still prism ground when the identity is earned but motion is off", () => {
    expect(source).toContain("showPrism && !prismAnimated");
  });
});
