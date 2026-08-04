import { describe, expect, it } from "vitest";
import {
  JOURNEY_DEFINITIONS,
  JOURNEY_STEP_IDS,
  buildJourney,
  type JourneyEvidence
} from "@/lib/journey/journey";

function evidence(completed: readonly (keyof JourneyEvidence)[] = []): JourneyEvidence {
  const completedSteps = new Set(completed);
  return Object.fromEntries(JOURNEY_STEP_IDS.map((id) => [id, completedSteps.has(id)])) as JourneyEvidence;
}

describe("canonical Journey model", () => {
  it("defines the ten ordered product steps with a destination and unlock condition", () => {
    expect(JOURNEY_DEFINITIONS.map((step) => step.id)).toEqual(JOURNEY_STEP_IDS);
    expect(JOURNEY_DEFINITIONS).toHaveLength(10);
    for (const step of JOURNEY_DEFINITIONS) {
      expect(step.title).not.toBe("");
      expect(step.description).not.toBe("");
      expect(step.unlockCondition).not.toBe("");
      expect(step.destination).toMatch(/^\//);
    }
  });

  it("reveals only the first incomplete step and locks later incomplete steps", () => {
    const journey = buildJourney(evidence());
    expect(journey.currentStep?.id).toBe("complete_profile");
    expect(journey.steps.filter((step) => step.state === "current")).toHaveLength(1);
    expect(journey.steps.slice(1).every((step) => step.state === "locked")).toBe(true);
  });

  it("keeps canonically completed steps visible while advancing to the next action", () => {
    const journey = buildJourney(evidence(["complete_profile", "add_first_muddy", "share_first_moment"]));
    expect(journey.completedCount).toBe(3);
    expect(journey.currentStep?.id).toBe("turn_on_visibility");
    expect(journey.steps.find((step) => step.id === "share_first_moment")?.state).toBe("completed");
    expect(journey.steps.find((step) => step.id === "send_first_wave")?.state).toBe("locked");
  });

  it("has no current action after every canonical step is complete", () => {
    const journey = buildJourney(evidence(JOURNEY_STEP_IDS));
    expect(journey.completedCount).toBe(10);
    expect(journey.currentStep).toBeNull();
    expect(journey.steps.every((step) => step.state === "completed")).toBe(true);
  });

  it("attaches replay links only for guides confirmed by the walkthrough service", () => {
    const guides = new Map([["profile-guide", "published-profile-version"]]);
    const journey = buildJourney(evidence(["complete_profile"]), guides);
    expect(journey.steps[0].guide).toEqual({ slug: "profile-guide", tourVersionId: "published-profile-version" });
    expect(journey.steps[1].guide).toBeNull();
  });
});
