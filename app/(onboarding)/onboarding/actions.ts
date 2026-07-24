"use server";

import { after } from "next/server";
import { grantAchievement } from "@/lib/engagement/achievements";
import { completeOnboarding } from "@/lib/onboarding/complete";
import { CURRENT_POLICY_VERSION, SAFE_DEFAULT_PRIVACY_SETUP } from "@/lib/onboarding/rules";
import { recordMilestone } from "@/lib/onboarding/service";
import { normalizeUsername, validateUsername } from "@/lib/profile/rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type OnboardingActionState = {
  ok: boolean;
  message: string;
  field?: "username";
};

export type UsernameCheckState = {
  status: "available" | "invalid" | "taken" | "error";
  message: string;
  username: string;
};

/**
 * Live username availability + format check for the onboarding field. Lets the
 * user learn a username is taken AT the field (with a green checklist) instead
 * of only discovering it at the final "Finish setup" step — which is what left
 * new users unable to complete onboarding. Usernames are public (people add
 * each other by username), so an availability probe reveals nothing sensitive.
 */
export async function checkUsernameAvailabilityAction(usernameInput: unknown): Promise<UsernameCheckState> {
  const raw = typeof usernameInput === "string" ? usernameInput : "";
  const username = normalizeUsername(raw);

  const formatError = validateUsername(username);
  if (formatError) return { status: "invalid", message: formatError, username };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Log in again to check this username.", username };

  // The account already holds a placeholder username, so a match on the user's
  // own id is fine — only another account taking it makes it unavailable.
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("user_id")
    .or(`username.eq.${username},username_normalized.eq.${username}`)
    .limit(1)
    .maybeSingle();
  if (error) {
    return { status: "error", message: "Couldn't check this username. Try again.", username };
  }
  if (data && data.user_id !== user.id) {
    return { status: "taken", message: "That username is already taken.", username };
  }
  return { status: "available", message: "Username is available.", username };
}

export async function completeOnboardingAction(input: unknown): Promise<OnboardingActionState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { ok: false, message: "Log in before finishing onboarding." };
  }

  return completeOnboarding(user.id, input);
}

/**
 * Finishes the simplified setup in one server-controlled sequence. Applying
 * the safest privacy defaults here removes a whole decision-heavy screen while
 * preserving the product rule that every new account starts hidden.
 */
export async function finishOnboardingAction(
  input: unknown,
  skippedOptional: boolean
): Promise<OnboardingActionState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { ok: false, message: "Log in before finishing setup." };
  }

  const profileResult = await completeOnboarding(user.id, input);
  if (!profileResult.ok) return profileResult;

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const [progressResult, onboardedResult, privacyVersionResult] = await Promise.all([
    admin.from("onboarding_progress").upsert(
      {
        user_id: user.id,
        current_step: "completed",
        profile_completed_at: nowIso,
        privacy_reviewed_at: nowIso,
        visibility_configured_at: nowIso,
        completed_at: nowIso,
        skipped_optional: skippedOptional,
        updated_at: nowIso
      },
      { onConflict: "user_id" }
    ),
    admin
      .from("profiles")
      .update({
        is_onboarded: true,
        visibility_status: SAFE_DEFAULT_PRIVACY_SETUP.glowAudience === "hidden" ? "ghost" : "visible"
      })
      .eq("user_id", user.id),
    admin.from("privacy_setup_versions").upsert(
      {
        user_id: user.id,
        policy_version: CURRENT_POLICY_VERSION,
        setup_completed_at: nowIso,
        last_reviewed_at: nowIso,
        updated_at: nowIso
      },
      { onConflict: "user_id" }
    )
  ]);

  if (progressResult.error || onboardedResult.error || privacyVersionResult.error) {
    // Completion is retry-safe. If one of the parallel writes failed, do not
    // leave the profile marked as onboarded while its privacy setup is partial.
    await admin.from("profiles").update({ is_onboarded: false }).eq("user_id", user.id);
    return { ok: false, message: "Your profile was saved, but setup could not finish. Try again." };
  }

  // Milestones and achievements are useful, but they must never hold the user
  // on the final onboarding screen. Next keeps this work alive after the action
  // response without making it part of the critical completion path.
  after(async () => {
    await Promise.all([
      recordMilestone(admin, user.id, "profile_completed"),
      recordMilestone(admin, user.id, "privacy_setup_completed"),
      grantAchievement(admin, user.id, "privacy_pro")
    ]);
  });

  return {
    ok: true,
    message: skippedOptional ? "You're ready. You can finish your profile anytime." : "You're all set."
  };
}
