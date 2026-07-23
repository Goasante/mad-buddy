"use server";

import { completeOnboarding, savePrivacySetup } from "@/lib/onboarding/complete";
import { SAFE_DEFAULT_PRIVACY_SETUP } from "@/lib/onboarding/rules";
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

  const privacyResult = await savePrivacySetup(user.id, SAFE_DEFAULT_PRIVACY_SETUP);
  if (!privacyResult.ok) return privacyResult;

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const [progressResult, onboardedResult] = await Promise.all([
    admin.from("onboarding_progress").upsert(
      {
        user_id: user.id,
        current_step: "completed",
        profile_completed_at: nowIso,
        completed_at: nowIso,
        skipped_optional: skippedOptional,
        updated_at: nowIso
      },
      { onConflict: "user_id" }
    ),
    admin.from("profiles").update({ is_onboarded: true }).eq("user_id", user.id),
    recordMilestone(admin, user.id, "profile_completed")
  ]);

  if (progressResult.error || onboardedResult.error) {
    return { ok: false, message: "Your profile was saved, but setup could not finish. Try again." };
  }

  return {
    ok: true,
    message: skippedOptional ? "You're ready. You can finish your profile anytime." : "You're all set."
  };
}
