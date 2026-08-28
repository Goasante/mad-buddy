import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProfileEditVNext } from "@/components/profile/profile-edit-vnext";
import { loadEffectivePlan } from "@/lib/billing/service";
import { loadDateOfBirthState } from "@/lib/profile/date-of-birth-service";
import { loadVisibleProfilePhotosFor } from "@/lib/profile/photo-service";
import { loadFieldPrivacy } from "@/lib/profile/service";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edit Profile Lab",
  robots: { index: false, follow: false }
};

export default async function ProfileLabEditPage() {
  const labAccess = await getSafetyAdminContext();
  if (!labAccess.ok) redirect("/profile");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, username, bio, mood_status, avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();

  const admin = createSupabaseAdminClient();
  const [plan, birthDetails, fieldPrivacy, photos] = await Promise.all([
    loadEffectivePlan(admin, user.id),
    loadDateOfBirthState(user.id),
    loadFieldPrivacy(admin, user.id),
    loadVisibleProfilePhotosFor(admin, user.id, { isOwner: true, isApprovedMuddy: false })
  ]);

  return (
    <ProfileEditVNext
      initialDisplayName={profile?.full_name ?? user.user_metadata?.full_name ?? "Your name"}
      initialUsername={profile?.username ?? user.user_metadata?.username ?? "username"}
      initialBio={profile?.bio ?? ""}
      initialMoodStatus={profile?.mood_status ?? ""}
      initialAvatarUrl={profile?.avatar_url ?? null}
      initialDateOfBirth={birthDetails?.dateOfBirth ?? ""}
      initialDateOfBirthCanCorrect={birthDetails?.canCorrect ?? true}
      initialBirthdayVisibility={fieldPrivacy?.birthday === "approved_muddies" ? "approved_muddies" : "only_me"}
      initialAgeVisibility={fieldPrivacy?.age === "approved_muddies" ? "approved_muddies" : "only_me"}
      initialZodiacVisibility={fieldPrivacy?.zodiac === "approved_muddies" ? "approved_muddies" : "only_me"}
      photos={photos}
      plan={plan}
    />
  );
}
