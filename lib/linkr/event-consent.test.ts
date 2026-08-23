import { describe, expect, it } from "vitest";
import { isCandidateEligible, type CandidateEligibilityInput } from "@/lib/linkr/rules";

/**
 * Event Linkr consent: three separate things that must never be conflated.
 *
 *   GOING     — I intend to attend.
 *   CHECK-IN  — I am physically here.
 *   EVENT LINKR — I am open to meeting new people here.
 *
 * Each is a strictly narrower statement than the last, and only the third is
 * consent to be discovered. Collapsing any two of them would mean someone who
 * merely showed up becomes discoverable without ever having said yes — which is
 * the exact failure the Product Constitution's "Event Linkr consent" rule
 * exists to prevent.
 *
 * `isCandidateEligible` is the single authority that decides discoverability,
 * and it is a pure function, so this tests the real decision rather than a
 * reconstruction of it. Its own comment states the governing property:
 * "Event Mode narrows; it never widens."
 */

/** A candidate who would be eligible for ordinary Linkr, with Event Mode off. */
function baseline(overrides: Partial<CandidateEligibilityInput> = {}): CandidateEligibilityInput {
  return {
    isSelf: false,
    blockedEitherDirection: false,
    candidateDiscoverable: true,
    eventModeActive: false,
    eventEligible: false,
    alreadyConnected: false,
    alreadyActedOn: false,
    viewerIntent: "friends",
    candidateIntent: "friends",
    allowedTiers: ["close", "near", "far"],
    tier: "near",
    presenceExpired: false,
    requirePhotos: false,
    candidateHasShowcasePhotos: true,
    onlyActiveNow: false,
    candidateActiveNow: true,
    onlyNewToday: false,
    candidateJoinedToday: false,
    ...overrides
  } as CandidateEligibilityInput;
}

describe("Event Linkr: consent is not implied by presence", () => {
  it("an ordinary eligible candidate is eligible (the baseline is not vacuous)", () => {
    // Without this, every assertion below could pass because the fixture is
    // ineligible for some unrelated reason.
    expect(isCandidateEligible(baseline()).eligible).toBe(true);
  });

  it("being at the Event does NOT make someone discoverable", () => {
    /* Event Mode active, but this candidate has not opted in, so eventEligible
       is false. Attendance alone must not produce a candidate. */
    const verdict = isCandidateEligible(baseline({ eventModeActive: true, eventEligible: false }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("not_event_eligible");
  });

  it("opting in to Event Linkr is what makes someone discoverable", () => {
    const verdict = isCandidateEligible(baseline({ eventModeActive: true, eventEligible: true }));
    expect(verdict.eligible).toBe(true);
  });

  it("Event Mode narrows and never widens: it cannot rescue an ineligible candidate", () => {
    /* The property the authority's own comment claims. Someone who fails
       ordinary Linkr eligibility must not become eligible merely because they
       are at the same Event — otherwise an Event would be a way around every
       other rule. */
    const notDiscoverable = isCandidateEligible(
      baseline({ eventModeActive: true, eventEligible: true, candidateDiscoverable: false })
    );
    expect(notDiscoverable.eligible).toBe(false);
    expect(notDiscoverable.reason).toBe("not_discoverable");

    const intentMismatch = isCandidateEligible(
      baseline({
        eventModeActive: true,
        eventEligible: true,
        viewerIntent: "dating",
        candidateIntent: "friends"
      })
    );
    expect(intentMismatch.eligible).toBe(false);
  });

  it("a block beats Event eligibility, and is decided before anything else", () => {
    /* Order matters as much as outcome: blocking is evaluated second, after
       self, so no later rule can accidentally short-circuit past it. */
    const verdict = isCandidateEligible(
      baseline({ eventModeActive: true, eventEligible: true, blockedEitherDirection: true })
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("blocked");
  });

  it("revoking Event eligibility removes discoverability immediately", () => {
    /* Checkout, opt-out and Event end all converge on the same signal:
       eventEligible goes false. Whatever the cause, the candidate stops being
       discoverable on the very next evaluation — there is no grace window in
       which a departed attendee remains visible. */
    const optedIn = baseline({ eventModeActive: true, eventEligible: true });
    expect(isCandidateEligible(optedIn).eligible).toBe(true);

    const revoked = { ...optedIn, eventEligible: false };
    expect(isCandidateEligible(revoked).eligible).toBe(false);
    expect(isCandidateEligible(revoked).reason).toBe("not_event_eligible");
  });

  it("an existing connection is excluded from candidacy, not re-offered", () => {
    // The survival property's other half: a pair who already matched should
    // stop appearing as candidates rather than being shown repeatedly.
    const verdict = isCandidateEligible(
      baseline({ eventModeActive: true, eventEligible: true, alreadyConnected: true })
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("already_connected");
  });

  it("presence expiry removes an attendee who has gone stale", () => {
    const verdict = isCandidateEligible(
      baseline({ eventModeActive: true, eventEligible: true, presenceExpired: true })
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("presence_expired");
  });
});
