import { POST_LOGIN_ROUTE } from "@/lib/routes";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import type { MoodStatus } from "@/components/onboarding/mood-status-selector";
import { redirect } from "next/navigation";
import {
  isPlaceholderUsername,
  PLACEHOLDER_DISPLAY_NAME
} from "@/lib/profile/placeholder-identity";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recoverOnboardingIfStranded } from "@/lib/onboarding/recovery-service";

// Renders per-user billing/onboarding state; never statically prerender
// (build environments have no Supabase secrets).
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  let initialName = "";
  let initialUsername = "";
  let initialBio = "";
  let initialMood: MoodStatus | null = null;
  let initialDateOfBirth = "";

  const env = getSupabaseServerEnv();
  if (env.url) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, username, bio, mood_status, is_onboarded")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profile?.is_onboarded) {
        redirect(POST_LOGIN_ROUTE);
      }

      // Self-healing: an account whose completion write partially failed keeps
      // a fully filled profile but is_onboarded = false, and would otherwise be
      // sent back here on every visit with no way out. If the data shows the
      // user already finished, finish provisioning and let them through.
      // Conservative by design — a genuinely new account decides "none" and
      // continues to normal onboarding below.
      const serverEnv = getSupabaseServerEnv();
      if (serverEnv.url && serverEnv.serviceRoleKey) {
        const recovery = await recoverOnboardingIfStranded(createSupabaseAdminClient(), user.id);
        if (recovery.action === "finish") {
          redirect(POST_LOGIN_ROUTE);
        }
      }
      const profileName =
        profile?.full_name ??
        (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "");
      initialName = profileName === PLACEHOLDER_DISPLAY_NAME ? "" : profileName;
      const profileUsername =
        profile?.username ?? user.email?.split("@")[0]?.replace(/[^a-z0-9_]/gi, "").toLowerCase() ?? "";
      initialUsername = isPlaceholderUsername(profileUsername) ? "" : profileUsername;
      initialBio = profile?.bio ?? "";
      initialMood = ["open", "busy", "exploring", "quiet"].includes(profile?.mood_status ?? "")
        ? (profile?.mood_status as MoodStatus)
        : null;
      const { data: birthDetails } = await supabase
        .from("profile_birth_details")
        .select("date_of_birth")
        .eq("user_id", user.id)
        .maybeSingle();
      initialDateOfBirth = birthDetails?.date_of_birth ?? "";
    }
  }

  return (
    <OnboardingFlow
      initialName={initialName}
      initialUsername={initialUsername}
      initialBio={initialBio}
      initialMood={initialMood}
      initialDateOfBirth={initialDateOfBirth}
    />
  );
}
