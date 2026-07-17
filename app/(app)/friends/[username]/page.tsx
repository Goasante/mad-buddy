import { notFound } from "next/navigation";
import { MuddyProfilePage } from "@/components/friends/muddy-profile-page";
import { getPublicTrustSummary } from "@/lib/discovery/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function MuddyProfileRoute({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const admin = createSupabaseAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, full_name, username, bio, mood_status")
    .eq("username", username)
    .maybeSingle();

  if (!profile) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const trust =
    user && user.id !== profile.user_id
      ? await getPublicTrustSummary(admin, user.id, profile.user_id)
      : null;

  return (
    <MuddyProfilePage
      muddy={{
        friendId: profile.user_id,
        displayName: profile.full_name,
        username: profile.username,
        bio: profile.bio ?? "",
        moodStatus: profile.mood_status ?? "",
        mutualMuddies: trust?.mutualCount ?? 0
      }}
      trust={trust}
    />
  );
}
