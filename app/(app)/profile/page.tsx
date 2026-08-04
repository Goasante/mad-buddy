import { ProfilePageContent } from "@/components/profile/profile-page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadEffectivePlan } from "@/lib/billing/service";
import { loadFieldPrivacy } from "@/lib/profile/service";
import { dateKeyInTimeZone } from "@/lib/profile/birth-date";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import { loadProfileIdentitySummary } from "@/lib/profile/identity-service";
import { loadJourney } from "@/lib/journey/journey-service";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams
}: {
  searchParams?: Promise<{ birthdayPreview?: string; birthdayPrivacyDisabled?: string }>;
}) {
  const previewParams = await searchParams;
  const birthdayPreview = process.env.NODE_ENV !== "production" && previewParams?.birthdayPreview === "1";
  const birthdayPrivacyDisabled =
    process.env.NODE_ENV !== "production" && previewParams?.birthdayPrivacyDisabled === "1";
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

  const admin = createSupabaseAdminClient();
  const [effectivePlan, birthDetails, fieldPrivacy, identitySummary, journey] = user
    ? await Promise.all([
        loadEffectivePlan(admin, user.id),
        admin
          .from("profile_birth_details")
          .select("date_of_birth")
          .eq("user_id", user.id)
          .maybeSingle()
          .then((result) => result.data),
        loadFieldPrivacy(admin, user.id),
        loadProfileIdentitySummary(admin, user.id, "self"),
        loadJourney(admin, user.id)
      ])
    : ["free" as const, null, null, null, null];

  return (
    <ProfilePageContent
      initialDisplayName={profile?.full_name ?? user?.user_metadata?.full_name ?? "Your name"}
      initialUsername={profile?.username ?? user?.user_metadata?.username ?? "username"}
      initialBio={profile?.bio ?? ""}
      initialMoodStatus={profile?.mood_status ?? ""}
      initialAvatarUrl={profile?.avatar_url ?? null}
      initialVisibilityStatus={profile?.visibility_status ?? "visible"}
      identitySummary={identitySummary}
      journey={journey}
      initialPlan={effectivePlan}
      initialDateOfBirth={birthDetails?.date_of_birth ?? ""}
      initialBirthdayVisibility={fieldPrivacy?.birthday === "approved_muddies" ? "approved_muddies" : "only_me"}
      initialAgeVisibility={fieldPrivacy?.age === "approved_muddies" ? "approved_muddies" : "only_me"}
      initialZodiacVisibility={fieldPrivacy?.zodiac === "approved_muddies" ? "approved_muddies" : "only_me"}
      serverBirthdayDayKey={dateKeyInTimeZone(new Date(), DEFAULT_RECIPIENT_TIMEZONE)}
      birthdayPreview={birthdayPreview && !birthdayPrivacyDisabled}
      birthdayPrivacyDisabledPreview={birthdayPrivacyDisabled}
    />
  );
}
