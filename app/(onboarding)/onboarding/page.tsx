import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import type { MoodStatus } from "@/components/onboarding/mood-status-selector";
import {
  isPlaceholderUsername,
  PLACEHOLDER_DISPLAY_NAME
} from "@/lib/profile/placeholder-identity";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Renders per-user billing/onboarding state; never statically prerender
// (build environments have no Supabase secrets).
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  let initialName = "";
  let initialUsername = "";
  let initialBio = "";
  let initialMood: MoodStatus | null = null;

  const env = getSupabaseServerEnv();
  if (env.url) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, username, bio, mood_status")
        .eq("user_id", user.id)
        .maybeSingle();
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
    }
  }

  return (
    <OnboardingFlow
      initialName={initialName}
      initialUsername={initialUsername}
      initialBio={initialBio}
      initialMood={initialMood}
    />
  );
}
