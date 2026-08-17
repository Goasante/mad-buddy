import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { NEARBY_STALE_AFTER_MS } from "@/lib/proximity/backend";
import {
  hasLocationSetupEvidence,
  isLocationFreshForProximity,
  LOCATION_SETUP_EVIDENCE_MS,
  PROXIMITY_FRESH_MS
} from "@/lib/proximity/freshness";
import {
  primaryActionFor,
  resolveActivationState,
  type ActivationInputs
} from "@/lib/activation/state";

/**
 * One timestamp, two questions.
 *
 * "Has this person set location up" and "can we say who is near them right now"
 * are different questions with different answers, and answering the second with
 * the first let Home tell somebody their friends were absent when the app had
 * simply lost track of where they were.
 */

const NOW = Date.UTC(2026, 7, 15, 20, 0, 0);
const ago = (ms: number) => NOW - ms;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const base: ActivationInputs = {
  muddyCount: 3,
  pendingOutgoingCount: 0,
  locationGranted: true,
  locationFreshForProximity: true,
  visibility: "visible",
  nearbyMuddyCount: 0,
  upcomingPlanCount: 0,
  milestones: new Set<string>()
};
const withState = (over: Partial<ActivationInputs>) => ({ ...base, ...over });

describe("the two questions are answered by two rules", () => {
  it("binds proximity freshness to the canonical nearby rule", () => {
    // Not "a number that happens to match" -- the same value, so a change to
    // one cannot leave the other behind.
    expect(PROXIMITY_FRESH_MS).toBe(NEARBY_STALE_AFTER_MS);
  });

  it("holds the viewer to the standard their Muddies are held to", () => {
    /* A Muddy is hidden once their signal is older than this. The viewer's own
     * fix was exempt, so a day-old position still produced confident distances
     * -- putting somebody outside range who was standing next to them. */
    expect(PROXIMITY_FRESH_MS).toBe(30 * MINUTE);
  });

  it("keeps setup evidence deliberately longer than a proximity claim", () => {
    // If these were equal, an afternoon indoors would replay the permission
    // education at somebody who granted it that morning.
    expect(LOCATION_SETUP_EVIDENCE_MS).toBeGreaterThan(PROXIMITY_FRESH_MS);
  });
});

describe("has location ever worked?", () => {
  it("says no when there has never been a fix", () => {
    expect(hasLocationSetupEvidence(null, NOW)).toBe(false);
  });

  it("says yes for a fix from earlier today", () => {
    expect(hasLocationSetupEvidence(ago(4 * HOUR), NOW)).toBe(true);
  });

  it("stops trusting a grant that has produced nothing for a day", () => {
    // Permission revoked in system settings produces no fixes, so this lapses
    // on its own rather than believing a stored intention.
    expect(hasLocationSetupEvidence(ago(24 * HOUR), NOW)).toBe(false);
  });

  it("treats a clock-skewed future fix as usable", () => {
    expect(hasLocationSetupEvidence(NOW + 5_000, NOW)).toBe(true);
  });
});

describe("can we say who is nearby?", () => {
  it("says yes for a fix from a few minutes ago", () => {
    expect(isLocationFreshForProximity(ago(5 * MINUTE), NOW)).toBe(true);
  });

  it("says no for a fix from earlier today", () => {
    // The exact case that produced a false "nobody is around".
    expect(isLocationFreshForProximity(ago(4 * HOUR), NOW)).toBe(false);
  });

  it("says no when there has never been a fix", () => {
    expect(isLocationFreshForProximity(null, NOW)).toBe(false);
  });

  it("accepts the boundary and rejects just past it", () => {
    expect(isLocationFreshForProximity(ago(PROXIMITY_FRESH_MS), NOW)).toBe(true);
    expect(isLocationFreshForProximity(ago(PROXIMITY_FRESH_MS + 1), NOW)).toBe(false);
  });
});

describe("a stale fix never becomes a claim about other people", () => {
  const stale = { locationGranted: true, locationFreshForProximity: false };

  it("does not tell somebody nobody is around", () => {
    /* THE INVARIANT. "No Muddies are close by" is a statement about the world;
     * a stale fix only supports "Mad Buddy cannot tell right now". The wrong
     * one is quietly self-confirming, because the person stops looking. */
    const state = resolveActivationState(withState({ ...stale, nearbyMuddyCount: 0 }));
    expect(state).not.toBe("no_one_nearby");
    expect(state).toBe("location_stale");
  });

  it("does not claim somebody IS around either", () => {
    // An old position corrupts both directions: it can report a Muddy "right
    // here" who left hours ago.
    const state = resolveActivationState(withState({ ...stale, nearbyMuddyCount: 2 }));
    expect(state).not.toBe("muddy_nearby");
    expect(state).toBe("location_stale");
  });

  it("asks for a refresh, not for permission again", () => {
    // Permission already exists. Sending them through first-time education
    // would be the app forgetting they said yes.
    expect(primaryActionFor("location_stale")).toBe("refresh_location");
    expect(primaryActionFor("location_stale")).not.toBe("enable_location");
  });

  it("still says location is missing when it truly never worked", () => {
    const never = withState({ locationGranted: false, locationFreshForProximity: false });
    expect(resolveActivationState(never)).toBe("muddies_no_location");
  });

  it("recovers on its own once a fresh fix arrives", () => {
    // No flag to clear: the next fix changes the answer.
    const recovered = withState({ locationFreshForProximity: true, nearbyMuddyCount: 1 });
    expect(resolveActivationState(recovered)).toBe("muddy_nearby");
  });
});

describe("visibility still outranks a refresh", () => {
  it("tells a ghost user the truer thing", () => {
    /* Refreshing a location changes nothing while somebody is invisible, so
     * the honest next step is the switch they never turned on. */
    const ghostAndStale = withState({
      visibility: "ghost",
      locationFreshForProximity: false
    });
    expect(resolveActivationState(ghostAndStale)).toBe("visibility_off");
  });

  it("keeps a fresh ghost user on visibility, not on nearby", () => {
    expect(resolveActivationState(withState({ visibility: "ghost" }))).toBe("visibility_off");
  });
});

describe("a long-standing user is not re-onboarded", () => {
  const veteran = {
    muddyCount: 25,
    locationGranted: true,
    locationFreshForProximity: false,
    milestones: new Set(["first_muddy_added", "first_plan_created", "first_wave_sent"])
  };

  it("gets ordinary recovery, not first-time education", () => {
    expect(resolveActivationState(withState(veteran))).toBe("location_stale");
  });

  it("gets nothing at all once the fix is current", () => {
    // Activation recedes after activation. Their Home is just Home.
    expect(resolveActivationState(withState({ ...veteran, locationFreshForProximity: true }))).toBe(
      "activated"
    );
  });

  it("still leads with a real plan over a refresh prompt", () => {
    const planned = withState({ ...veteran, upcomingPlanCount: 1 });
    expect(resolveActivationState(planned)).toBe("upcoming_plan");
  });
});

describe("the projection keeps the two answers apart", () => {
  const projection = stripComments(readFileSync("lib/activation/projection.ts", "utf8"));

  it("derives each fact from its own rule", () => {
    /* MUTATION FOUND THIS GAP. Asserting the helpers were merely imported let
     * `locationFreshForProximity = locationGranted` pass untouched -- which is
     * exactly the conflation being fixed, reintroduced one line lower down. */
    expect(projection).toContain("hasLocationSetupEvidence(lastFixMs, nowMs)");
    expect(projection).toContain("isLocationFreshForProximity(lastFixMs, nowMs)");
  });

  it("never derives one from the other", () => {
    expect(projection).not.toMatch(/locationFreshForProximity\s*=\s*locationGranted/);
    expect(projection).not.toMatch(/locationGranted\s*=\s*locationFreshForProximity/);
  });

  it("passes both into the state resolver", () => {
    /* Anchored to the RESOLVER INPUT, not to the file.
     *
     * The name appears twice more -- in the returned projection and its empty
     * fallback -- so an unanchored match passed while the resolver's own copy
     * was deleted. A fact computed and never handed over is the same as not
     * computing it. */
    /* Sliced FORWARD from the resolver inputs, not to the file's first
     * `return {`. A helper added above `loadActivationProjection` put a return
     * ahead of this block, so the old slice ran backwards and was empty --
     * passing vacuously. indexOf from the start offset cannot do that. */
    const start = projection.indexOf("const inputs: ActivationInputs = {");
    const inputs = projection.slice(start, projection.indexOf("};", start));
    expect(inputs).toContain("locationGranted,");
    expect(inputs).toContain("locationFreshForProximity,");
  });
});

describe("the recovery reads as a nudge, not a fault", () => {
  const card = stripComments(readFileSync("components/activation/activation-card.tsx", "utf8"));
  const copy = card.slice(card.indexOf("location_stale: {"), card.indexOf("no_one_nearby: {"));

  it("names Glow, the thing the person cares about", () => {
    expect(copy).toContain("Refresh");
    expect(copy).toContain("Glow");
  });

  it("says what Glow needs rather than what went wrong", () => {
    for (const blame of ["error", "failed", "Unable", "problem", "went wrong", "Sorry"]) {
      expect(copy).not.toContain(blame);
    }
  });

  it("exposes no timestamp, age or threshold", () => {
    /* How old is too old is Mad Buddy's problem. A number here would also
     * invite somebody to work out how precisely they are being tracked. */
    for (const leak of ["hours", "minutes", "30", "six", "old fix", "timestamp", "GPS"]) {
      expect(copy).not.toContain(leak);
    }
  });

  it("does not re-teach permission at somebody who already granted it", () => {
    expect(copy).not.toContain("Turn on location");
    expect(copy).not.toContain("Allow");
  });

  it("fires no geolocation call merely by rendering", () => {
    // A silent position request on page load is a prompt nobody asked for.
    expect(card).not.toContain("getCurrentPosition");
    expect(card).not.toContain("navigator.geolocation");
  });
});
