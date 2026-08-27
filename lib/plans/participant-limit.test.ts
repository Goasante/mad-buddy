import { describe, expect, it } from "vitest";

import {
  CANONICAL_MAX_PLAN_PARTICIPANTS,
  toCanonicalPlanLimit,
  toCanonicalParticipantLimit
} from "@/lib/plans/canonical-contract";
import { UNLIMITED } from "@/lib/billing/entitlements";

/**
 * The participant limit the canonical RPC will actually accept.
 *
 * WHY THIS EXISTS. `max_plan_participants` is deliberately UNLIMITED -- a cap
 * would mean paying to invite the eleventh friend to something you organised.
 * `toCanonicalPlanLimit` turned that Infinity into POSTGRES_INT_MAX, and
 * `create_plan_lifecycle` raises PLAN_PARTICIPANT_LIMIT_INVALID for anything
 * over 500. So every plan creation failed -- direct and UpFor conversion --
 * with "Check the plan details and try again", which named no field and gave
 * the person nothing to correct.
 */

describe("the value sent to create_plan_lifecycle", () => {
  it("never exceeds the ceiling the RPC enforces", () => {
    expect(toCanonicalParticipantLimit(UNLIMITED)).toBeLessThanOrEqual(
      CANONICAL_MAX_PLAN_PARTICIPANTS
    );
  });

  it("REGRESSION: an unlimited entitlement no longer sends POSTGRES_INT_MAX", () => {
    // The exact bug: the unclamped helper produces a value the RPC rejects.
    expect(toCanonicalPlanLimit(UNLIMITED)).toBeGreaterThan(CANONICAL_MAX_PLAN_PARTICIPANTS);
    expect(toCanonicalParticipantLimit(UNLIMITED)).toBe(CANONICAL_MAX_PLAN_PARTICIPANTS);
  });

  it("stays inside the RPC's accepted range for every plausible tier", () => {
    for (const tier of [1, 10, 50, 500, 501, 10_000, UNLIMITED]) {
      const sent = toCanonicalParticipantLimit(tier);
      expect(sent, `tier ${tier}`).toBeGreaterThanOrEqual(1);
      expect(sent, `tier ${tier}`).toBeLessThanOrEqual(CANONICAL_MAX_PLAN_PARTICIPANTS);
    }
  });

  it("passes a finite tier below the ceiling through untouched", () => {
    // Clamping must not quietly shrink a real paid limit.
    expect(toCanonicalParticipantLimit(10)).toBe(10);
    expect(toCanonicalParticipantLimit(499)).toBe(499);
  });

  it("leaves the ACTIVE-PLANS limit alone: only participants have this ceiling", () => {
    expect(toCanonicalPlanLimit(UNLIMITED)).toBe(2_147_483_647);
  });
});
