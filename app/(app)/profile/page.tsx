import { getProfileDetailsAction } from "@/app/(app)/profile-actions";
import { ProfileDetailsEditor } from "@/components/profile/profile-details-editor";
import { ProfilePageContent } from "@/components/profile/profile-page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("full_name, username, bio, mood_status, avatar_url, visibility_status")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  const muddyCount = user
    ? await createSupabaseAdminClient()
        .from("friendships")
        .select("user_one_id", { count: "exact", head: true })
        .or(`user_one_id.eq.${user.id},user_two_id.eq.${user.id}`)
        .then((result) => result.count ?? 0)
    : 0;

  const details = user ? await getProfileDetailsAction() : null;

  return (
    <div className="space-y-6">
      <ProfilePageContent
        initialDisplayName={profile?.full_name ?? user?.user_metadata?.full_name ?? "Your name"}
        initialUsername={profile?.username ?? user?.user_metadata?.username ?? "username"}
        initialBio={profile?.bio ?? ""}
        initialMoodStatus={profile?.mood_status ?? ""}
        initialAvatarUrl={profile?.avatar_url ?? null}
        initialVisibilityStatus={profile?.visibility_status ?? "visible"}
        muddyCount={muddyCount}
      />
      {details ? (
        <div className="mx-auto max-w-[900px] pb-8">
          <ProfileDetailsEditor initialDetails={details} />
        </div>
      ) : null}
    </div>
  );
}
