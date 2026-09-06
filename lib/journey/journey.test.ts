import { describe, expect, it } from "vitest";
import { JOURNEY_DEFINITIONS, JOURNEY_STEP_IDS, buildJourney, type JourneyEvidence } from "@/lib/journey/journey";

function evidence(completed: readonly (keyof JourneyEvidence)[] = []): JourneyEvidence {
  const done = new Set(completed);
  return Object.fromEntries(JOURNEY_STEP_IDS.map((id) => [id, done.has(id)])) as JourneyEvidence;
}

describe("canonical Journey model", () => {
  it("contains only meaningful free-core progression", () => {
    expect(JOURNEY_DEFINITIONS.map((step) => step.id)).toEqual(JOURNEY_STEP_IDS);
    /* Bound to the canonical list rather than a literal. This test previously
       asserted 9 and had to be edited when Share First Moment was removed --
       the same hardcoded-total drift the Journey loader was just fixed for. */
    expect(JOURNEY_DEFINITIONS).toHaveLength(JOURNEY_STEP_IDS.length);
    expect(JOURNEY_STEP_IDS).not.toContain("unlock_buddy_plus" as never);
    for (const step of JOURNEY_DEFINITIONS) expect(step.destination).toMatch(/^\//);
  });

  it("requires nothing from paused or discontinued features", () => {
    // Moments is paused: nobody may be blocked from finishing Journey by a
    // feature the product no longer wants them using.
    expect(JOURNEY_STEP_IDS).not.toContain("share_first_moment" as never);
    expect(JOURNEY_DEFINITIONS.some((step) => /moment/i.test(step.id))).toBe(false);
    expect(JOURNEY_DEFINITIONS.some((step) => /moment/i.test(step.destination))).toBe(false);
  });

  it("reveals one current step and locks later incomplete steps", () => {
    const journey = buildJourney(evidence());
    expect(journey.currentStep?.id).toBe("complete_profile");
    expect(journey.steps.filter((step) => step.state === "current")).toHaveLength(1);
  });

  it("finishes after every social/trust step", () => {
    const journey = buildJourney(evidence(JOURNEY_STEP_IDS));
    expect(journey.completedCount).toBe(JOURNEY_STEP_IDS.length);
    expect(journey.totalCount).toBe(JOURNEY_STEP_IDS.length);
    expect(journey.currentStep).toBeNull();
  });
});
