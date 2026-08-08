import { JOURNEY_STEP_IDS } from "@/lib/journey/journey";

/**
 * Trusted Member — who may apply, and what the badge means.
 *
 * WHAT IT IS NOT, stated first because the distinction is the whole point:
 * this is NOT identity verification. It says nothing about whether someone is
 * who they claim to be. It recognises a long-standing member who has used the
 * product fully and whom staff chose to recognise.
 *
 * That is why it is called "Trusted Member" rather than "Verified". A tick
 * earned by paying would tell every other user that Mad Buddy had checked an
 * ID, which would be false — and premium must never imply an identity check.
 *
 * Everything here is a pure function of its arguments: no clock reads, no
 * network. Eligibility is arithmetic, so the boundaries are testable as
 * arithmetic rather than through a rendered page.
 */

/**
 * How long someone must have held premium before they can apply.
 *
 * Ninety days is deliberately long. The badge is meant to mean "has been here
 * a while and stayed", and a threshold short enough to buy on Monday and wear
 * on Friday would make it a purchase with extra steps.
 */
export const TRUSTED_MEMBER_MIN_PREMIUM_DAYS = 90;

/** Every journey step must be complete. Not most — all of them. */
export const TRUSTED_MEMBER_REQUIRED_JOURNEYS = JOURNEY_STEP_IDS.length;

export type TrustedMemberStatus = "pending" | "approved" | "declined" | "revoked";

export type TrustedMemberEligibility = {
  eligible: boolean;
  premiumDays: number;
  journeysComplete: number;
  /** What is still missing, in the order a person would work through it. */
  missing: string[];
};

/**
 * May this account apply?
 *
 * Eligibility earns the right to ASK, never the badge itself. A human still
 * approves, which is what keeps it a mark of standing rather than a
 * subscription tier.
 */
export function trustedMemberEligibility(input: {
  /** Days of continuous premium. Computed from the subscription's start. */
  premiumDays: number;
  /** How many journey steps are complete. */
  journeysComplete: number;
}): TrustedMemberEligibility {
  const missing: string[] = [];

  if (input.premiumDays < TRUSTED_MEMBER_MIN_PREMIUM_DAYS) {
    const remaining = TRUSTED_MEMBER_MIN_PREMIUM_DAYS - input.premiumDays;
    missing.push(`${remaining} more ${remaining === 1 ? "day" : "days"} of Premium`);
  }

  if (input.journeysComplete < TRUSTED_MEMBER_REQUIRED_JOURNEYS) {
    const remaining = TRUSTED_MEMBER_REQUIRED_JOURNEYS - input.journeysComplete;
    missing.push(`${remaining} more ${remaining === 1 ? "journey" : "journeys"}`);
  }

  return {
    eligible: missing.length === 0,
    premiumDays: input.premiumDays,
    journeysComplete: input.journeysComplete,
    missing
  };
}

/**
 * Whole days of premium, from a subscription start date.
 *
 * Floored: someone 89.9 days in has not been here 90 days, and rounding up
 * would let the threshold be crossed by an afternoon.
 */
export function premiumDaysSince(startedAtIso: string | null, nowMs: number): number {
  if (!startedAtIso) return 0;
  const started = Date.parse(startedAtIso);
  if (!Number.isFinite(started) || started > nowMs) return 0;
  return Math.floor((nowMs - started) / (24 * 60 * 60 * 1000));
}

/**
 * Can this person apply right now, given any application they already have?
 *
 * A pending application blocks a second: the queue is a queue, not a way to
 * ask louder. An approved one has nothing left to ask for. A decline may be
 * revisited — people change, and a permanent refusal for a reversible reason
 * would be its own unfairness.
 */
export function canApplyForTrustedMember(input: {
  eligible: boolean;
  existingStatus: TrustedMemberStatus | null;
}): boolean {
  if (!input.eligible) return false;
  if (input.existingStatus === "pending") return false;
  if (input.existingStatus === "approved") return false;
  // "declined" and "revoked" may re-apply; null is a first application.
  return true;
}

/**
 * What the applicant is told about their own application.
 *
 * The review note is never included. Staff record why for each other; telling
 * an applicant "declined because we suspect X" turns a moderation decision
 * into an argument, and a vague reason is worse than none.
 */
export function trustedMemberStatusMessage(status: TrustedMemberStatus | null): string | null {
  switch (status) {
    case "pending":
      return "Your application is being reviewed.";
    case "approved":
      return "You're a Trusted Member.";
    case "declined":
      return "Your application wasn't approved this time. You can apply again.";
    case "revoked":
      return "Your Trusted Member status was removed. You can apply again.";
    default:
      return null;
  }
}
