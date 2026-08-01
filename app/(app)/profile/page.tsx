import { ProfilePageContent } from "@/components/profile/profile-page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadEffectivePlan } from "@/lib/billing/service";
import { loadFieldPrivacy } from "@/lib/profile/service";
import { dateKeyInTimeZone } from "@/lib/profile/birth-date";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import { loadBuddyScore } from "@/lib/engagement/buddy-score-service";

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
  const [muddyCount, badgeCount, effectivePlan, birthDetails, fieldPrivacy, buddyScore] = user
    ? await Promise.all([
        admin
          .from("friendships")
          .select("user_one_id", { count: "exact", head: true })
          .or(`user_one_id.eq.${user.id},user_two_id.eq.${user.id}`)
          .then((result) => result.count ?? 0),
        admin
          .from("user_achievements")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .then((result) => result.count ?? 0),
        loadEffectivePlan(admin, user.id),
        admin
          .from("profile_birth_details")
          .select("date_of_birth")
          .eq("user_id", user.id)
          .maybeSingle()
          .then((result) => result.data),
        loadFieldPrivacy(admin, user.id),
        loadBuddyScore(admin, user.id)
      ])
    : [0, 0, "free" as const, null, null, null];

  return (
    <ProfilePageContent
      initialDisplayName={profile?.full_name ?? user?.user_metadata?.full_name ?? "Your name"}
      initialUsername={profile?.username ?? user?.user_metadata?.username ?? "username"}
      initialBio={profile?.bio ?? ""}
      initialMoodStatus={profile?.mood_status ?? ""}
      initialAvatarUrl={profile?.avatar_url ?? null}
      initialVisibilityStatus={profile?.visibility_status ?? "visible"}
      muddyCount={muddyCount}
      badgeCount={badgeCount}
      buddyScore={buddyScore?.total ?? 0}
      buddyScoreLevel={buddyScore?.level.label ?? "New Buddy"}
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
