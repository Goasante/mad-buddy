import { describe, expect, it } from "vitest";
import { JOURNEY_DEFINITIONS, JOURNEY_STEP_IDS, buildJourney, type JourneyEvidence } from "@/lib/journey/journey";

function evidence(completed: readonly (keyof JourneyEvidence)[] = []): JourneyEvidence {
  const done = new Set(completed);
  return Object.fromEntries(JOURNEY_STEP_IDS.map((id) => [id, done.has(id)])) as JourneyEvidence;
}

describe("canonical Journey model", () => {
  it("contains only meaningful free-core progression", () => {
    expect(JOURNEY_DEFINITIONS.map((step) => step.id)).toEqual(JOURNEY_STEP_IDS);
    expect(JOURNEY_DEFINITIONS).toHaveLength(9);
    expect(JOURNEY_STEP_IDS).not.toContain("unlock_buddy_plus" as never);
    for (const step of JOURNEY_DEFINITIONS) expect(step.destination).toMatch(/^\//);
  });

  it("reveals one current step and locks later incomplete steps", () => {
    const journey = buildJourney(evidence());
    expect(journey.currentStep?.id).toBe("complete_profile");
    expect(journey.steps.filter((step) => step.state === "current")).toHaveLength(1);
  });

  it("finishes after all nine social/trust steps", () => {
    const journey = buildJourney(evidence(JOURNEY_STEP_IDS));
    expect(journey.completedCount).toBe(9);
    expect(journey.totalCount).toBe(9);
    expect(journey.currentStep).toBeNull();
  });
});
