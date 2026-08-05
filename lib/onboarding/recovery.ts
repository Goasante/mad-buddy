/**
 * Recovery for accounts stranded mid-onboarding.
 *
 * Onboarding completion writes three rows in parallel (progress, profile flag,
 * privacy version). If any one fails, the action deliberately rolls
 * `is_onboarded` back to false so a half-configured privacy state can never
 * look complete — see app/(onboarding)/onboarding/actions.ts.
 *
 * That rollback is correct, but it was terminal: the user kept a fully filled
 * profile and was bounced to /onboarding forever, with no way to finish. Two
 * real accounts reached that state.
 *
 * This module decides — from data alone — whether such an account has already
 * supplied everything onboarding asks for and can simply be finished, rather
 * than made to start again. It is pure and has no database access, so the
 * rules are testable in isolation.
 */

/** The onboarding-relevant shape of a profile row. */
export type RecoveryProfile = {
  is_onboarded: boolean;
  username: string | null;
  full_name: string | null;
  bio: string | null;
  mood_status: string | null;
};

/** Whether the user has an onboarding_progress row, and whether it completed. */
export type RecoveryProgress = {
  exists: boolean;
  completedAt: string | null;
} | null;

export type RecoveryDecision =
  /** Nothing to do — either genuinely new, or already finished. */
  | { action: "none"; reason: string }
  /** Profile is complete but provisioning never finished: finish it. */
  | { action: "finish"; reason: string };

/**
 * Placeholder identities created at signup, before the user has chosen
 * anything. Mirrors lib/profile/rules + the signup placeholder helpers: an
 * account still carrying one has genuinely not been through onboarding.
 */
function isPlaceholderIdentity(profile: RecoveryProfile): boolean {
  const username = profile.username?.trim() ?? "";
  const fullName = profile.full_name?.trim() ?? "";
  if (!username || !fullName) return true;
  // `muddy_ab12cd` / `user_ab12cd` style placeholders minted at signup.
  if (/^(muddy|user)_[a-z0-9]{4,8}$/i.test(username)) return true;
  return false;
}

/**
 * Decide what to do with an account that reached the app with
 * `is_onboarded = false`.
 *
 * Deliberately conservative — it only ever finishes an account that has
 * ALREADY supplied the onboarding essentials. A user who has not filled the
 * form still goes through onboarding normally, so this can never skip a step
 * or grant access someone did not earn.
 */
export function decideOnboardingRecovery(
  profile: RecoveryProfile | null,
  progress: RecoveryProgress
): RecoveryDecision {
  if (!profile) {
    return { action: "none", reason: "no profile row; provisioning must run first" };
  }

  if (profile.is_onboarded) {
    // Never touch a completed account.
    return { action: "none", reason: "already onboarded" };
  }

  if (progress?.completedAt) {
    // Progress says completed but the flag is false — exactly the rollback
    // state. The user finished; the flag is what failed.
    return { action: "finish", reason: "progress completed but profile flag was rolled back" };
  }

  if (isPlaceholderIdentity(profile)) {
    return { action: "none", reason: "identity is still a signup placeholder" };
  }

  // A real name, a real username, plus the two optional-but-prompted fields
  // means the user got to the end of the form. Anything less is a genuine
  // mid-onboarding account that should continue normally.
  const hasBio = Boolean(profile.bio?.trim());
  const hasMood = Boolean(profile.mood_status?.trim());
  if (hasBio && hasMood) {
    return {
      action: "finish",
      reason: "profile is complete but onboarding provisioning never finished"
    };
  }

  return { action: "none", reason: "onboarding genuinely incomplete" };
}
