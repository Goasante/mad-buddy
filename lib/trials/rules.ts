import type { SubscriptionPlan, SubscriptionStatus } from "@/lib/supabase/database.types";

export type TrialEligibilityCode =
  | "eligible"
  | "trials_disabled"
  | "trial_not_available"
  | "owner_grant_required"
  | "already_paid"
  | "trial_already_active"
  | "trial_already_used"
  | "profile_required"
  | "onboarding_required"
  | "account_too_new";

export type TrialEligibilityInput = {
  enabled: boolean;
  audience: "all_eligible" | "owner_grant_only";
  availableFromMs: number | null;
  availableUntilMs: number | null;
  minimumAccountAgeDays: number;
  requiresCompletedOnboarding: boolean;
  profileCreatedAtMs: number | null;
  isOnboarded: boolean;
  paidPlan: SubscriptionPlan;
  paidStatus: SubscriptionStatus;
  paidPeriodEndMs: number | null;
  paidGraceEndsMs: number | null;
  hasActiveTrial: boolean;
  hasTrialHistory: boolean;
  nowMs: number;
};

const PAID_ACCESS = new Set<SubscriptionStatus>(["active", "trialing", "non_renewing", "past_due", "attention"]);

export function hasPaidAccess(input: Pick<
  TrialEligibilityInput,
  "paidPlan" | "paidStatus" | "paidPeriodEndMs" | "paidGraceEndsMs" | "nowMs"
>) {
  if (input.paidPlan === "free" || !PAID_ACCESS.has(input.paidStatus)) return false;
  if (input.paidGraceEndsMs !== null && input.paidGraceEndsMs <= input.nowMs) return false;
  if (
    input.paidStatus !== "active" &&
    input.paidStatus !== "trialing" &&
    input.paidPeriodEndMs !== null &&
    input.paidPeriodEndMs <= input.nowMs &&
    input.paidGraceEndsMs === null
  ) {
    return false;
  }
  return true;
}

export function evaluateTrialEligibility(input: TrialEligibilityInput): TrialEligibilityCode {
  if (hasPaidAccess(input)) return "already_paid";
  if (input.hasActiveTrial) return "trial_already_active";
  if (input.hasTrialHistory) return "trial_already_used";
  if (!input.enabled) return "trials_disabled";
  if (
    (input.availableFromMs !== null && input.nowMs < input.availableFromMs) ||
    (input.availableUntilMs !== null && input.nowMs >= input.availableUntilMs)
  ) {
    return "trial_not_available";
  }
  if (input.audience === "owner_grant_only") return "owner_grant_required";
  if (input.profileCreatedAtMs === null) return "profile_required";
  if (input.requiresCompletedOnboarding && !input.isOnboarded) return "onboarding_required";
  if (input.profileCreatedAtMs > input.nowMs - input.minimumAccountAgeDays * 86_400_000) {
    return "account_too_new";
  }
  return "eligible";
}

export function trialEligibilityMessage(code: TrialEligibilityCode) {
  switch (code) {
    case "eligible":
      return "Your premium trial is ready.";
    case "already_paid":
      return "Your paid plan already includes premium access.";
    case "trial_already_active":
      return "Your premium trial is already active.";
    case "trial_already_used":
      return "This account has already used a premium trial.";
    case "onboarding_required":
      return "Finish the required account setup before starting a trial.";
    case "account_too_new":
      return "This account is not eligible for a trial yet.";
    default:
      return "A premium trial is not available for this account.";
  }
}
