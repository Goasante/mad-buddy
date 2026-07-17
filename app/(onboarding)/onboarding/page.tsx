import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Renders per-user billing/onboarding state; never statically prerender
// (build environments have no Supabase secrets).
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  let initialName = "";
  let initialUsername = "";
  let initialBio = "";

  const env = getSupabaseServerEnv();
  if (env.url) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, username, bio")
        .eq("user_id", user.id)
        .maybeSingle();
      initialName =
        profile?.full_name ??
        (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "");
      initialUsername =
        profile?.username ?? user.email?.split("@")[0]?.replace(/[^a-z0-9_]/gi, "").toLowerCase() ?? "";
      initialBio = profile?.bio ?? "";
    }
  }

  return <OnboardingFlow initialName={initialName} initialUsername={initialUsername} initialBio={initialBio} />;
}
