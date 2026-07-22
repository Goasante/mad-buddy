"use server";

import { completeOnboarding } from "@/lib/onboarding/complete";
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
