import { notFound } from "next/navigation";
import { MuddyProfilePage } from "@/components/friends/muddy-profile-page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

  return (
    <MuddyProfilePage
      muddy={{
        friendId: profile.user_id,
        displayName: profile.full_name,
        username: profile.username,
        bio: profile.bio ?? "",
        moodStatus: profile.mood_status ?? "",
        mutualMuddies: 0
      }}
    />
  );
}
