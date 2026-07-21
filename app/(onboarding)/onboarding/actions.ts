"use server";

import { completeOnboarding } from "@/lib/onboarding/complete";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type OnboardingActionState = {
  ok: boolean;
  message: string;
};

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
