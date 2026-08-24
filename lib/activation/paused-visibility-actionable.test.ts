import { describe, expect, it } from "vitest";
import { proximityAllowsNearby } from "@/lib/activation/home-composition";
import { primaryActionFor, resolveActivationState } from "@/lib/activation/state";

/**
 * A6 -- "Visibility is paused" must be resolvable from Home.
 *
 * The owner asked for the paused Home state to become actionable. What the
 * code turned out to show is that Home ALREADY answers this, on a different
 * surface than the wording pointed at: when visibility is off, the nearby
 * section stands down entirely -- `visibility_off` is a proximity-unknown
 * state, so `showNearby` is false -- and the activation card takes over with
 * "Turn on visibility", a real button wired to the canonical resume.
 *
 * That is the correct arrangement, and deliberately so: exactly one surface
 * owns the instruction rather than two disagreeing about the next step. These
 * tests pin it in place, so the paused state can never become a dead end
 * again -- if `visibility_off` ever stops offering the resume, or the nearby
 * empty state starts competing with it, this fails.
 */
const baseInputs = {
  muddyCount: 3,
  pendingOutgoingCount: 0,
  locationGranted: true,
  locationFreshForProximity: true,
  visibility: "visible" as "visible" | "ghost" | "app_open_only",
  nearbyMuddyCount: 0,
  upcomingPlanCount: 0,
  milestones: new Set<string>()
};

describe("paused visibility is actionable from Home", () => {
  it("reaches the paused state from a ghosted profile", () => {
    expect(resolveActivationState({ ...baseInputs, visibility: "ghost" })).toBe("visibility_off");
  });

  it("offers the resume as the primary action for that state", () => {
    expect(primaryActionFor("visibility_off")).toBe("enable_visibility");
  });

  it("stands the nearby section down while paused, so one surface owns the fix", () => {
    expect(proximityAllowsNearby({ activationState: "visibility_off" })).toBe(false);
  });

  it("stops offering the resume once visibility is restored", () => {
    const state = resolveActivationState(baseInputs);
    expect(state).not.toBe("visibility_off");
    expect(primaryActionFor(state)).not.toBe("enable_visibility");
  });

  it("lets the nearby section speak again once visibility is back", () => {
    const state = resolveActivationState(baseInputs);
    expect(proximityAllowsNearby({ activationState: state })).toBe(true);
  });
});
