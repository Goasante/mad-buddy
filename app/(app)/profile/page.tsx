import { ProfilePageContent } from "@/components/profile/profile-page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadEffectivePlan } from "@/lib/billing/service";
import { loadFieldPrivacy } from "@/lib/profile/service";
import { profileCompletionPercent, remainingCompletionTasks } from "@/lib/profile/rules";
import { loadDateOfBirthState } from "@/lib/profile/date-of-birth-service";
import { dateKeyInTimeZone } from "@/lib/profile/birth-date";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import { loadProfileIdentitySummary } from "@/lib/profile/identity-service";
import { loadVisibleProfilePhotosFor } from "@/lib/profile/photo-service";
import { getTrustedMemberStandingAction } from "@/app/(app)/trusted-member-actions";
import { isProfileSection, isSafeReturnPath } from "@/lib/navigation/handoff";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams
}: {
  /* HANDOFF PARAMETERS (§7, §8).
   *
   * `section` and `returnTo` were being SENT by Linkr and read by nobody: this
   * page's params type listed only the two birthday preview flags, so the deep
   * link resolved to an ordinary Profile page with no way back to whatever the
   * person was in the middle of. */
  searchParams?: Promise<{
    birthdayPreview?: string;
    birthdayPrivacyDisabled?: string;
    section?: string;
    returnTo?: string;
    from?: string;
  }>;
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
        // `institution` feeds completion; `general_area` remains part of the
        // canonical self-profile projection even though the compact hero does
        // not surface it.
        .select(
          "full_name, username, bio, mood_status, avatar_url, visibility_status, trusted_member_since, institution, general_area"
        )
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  const admin = createSupabaseAdminClient();
  const [effectivePlan, birthDetails, fieldPrivacy, identitySummary, photos, trustedStanding, interestRows] = user
    ? await Promise.all([
        loadEffectivePlan(admin, user.id),
        loadDateOfBirthState(user.id),
        loadFieldPrivacy(admin, user.id),
        loadProfileIdentitySummary(admin, user.id, "self"),
        // The owner sees every photo, including only_me — a photo you cannot
        // see is a photo you cannot manage. Loaded here in the same parallel
        // batch rather than as a follow-up request.
        loadVisibleProfilePhotosFor(admin, user.id, { isOwner: true, isApprovedMuddy: false }),
        getTrustedMemberStandingAction(),
        // The owner's own interests: no privacy narrowing, you always see
        // everything on your own profile.
        admin.from("user_interests").select("interest").eq("user_id", user.id)
      ])
    : ["free" as const, null, null, null, [], null, null];

  /* Completion comes from the shared authority in lib/profile/rules rather
   * than being counted in the component, so this page and onboarding can
   * never disagree about what "complete" means. */
  const interests = (interestRows?.data ?? []).map((row) => row.interest);
  const completionInput = {
    hasDisplayName: Boolean(profile?.full_name?.trim()),
    hasUsername: Boolean(profile?.username?.trim()),
    hasPhoto: Boolean(profile?.avatar_url),
    hasBio: Boolean(profile?.bio?.trim()),
    hasInstitution: Boolean(profile?.institution?.trim()),
    hasInterests: interests.length > 0,
    hasFirstMuddy: (identitySummary?.activity?.muddyCount ?? 0) > 0
  };
  const completion = user
    ? {
        percent: profileCompletionPercent(completionInput),
        tasks: remainingCompletionTasks(completionInput)
      }
    : null;

  /* Validated HERE, on the server, rather than passed through to the client.
   * returnTo arrives in a URL and is attacker-supplied regardless of who
   * wrote the link, so an unsafe one becomes null and the page simply renders
   * without a return control -- never an error, never an open redirect. */
  const section = isProfileSection(previewParams?.section) ? previewParams.section : null;
  const returnTo = isSafeReturnPath(previewParams?.returnTo) ? previewParams.returnTo : null;
  const handoffOrigin = returnTo ? (previewParams?.from ?? null) : null;

  return (
    <ProfilePageContent
      section={section}
      returnTo={returnTo}
      handoffOrigin={handoffOrigin}
      initialDisplayName={profile?.full_name ?? user?.user_metadata?.full_name ?? "Your name"}
      initialUsername={profile?.username ?? user?.user_metadata?.username ?? "username"}
      initialBio={profile?.bio ?? ""}
      initialMoodStatus={profile?.mood_status ?? ""}
      initialAvatarUrl={profile?.avatar_url ?? null}
      initialVisibilityStatus={profile?.visibility_status ?? "visible"}
      identitySummary={identitySummary}
      interests={interests}
      completion={completion}
      generalArea={profile?.general_area ?? null}
      photos={photos}
      trustedSince={profile?.trusted_member_since ?? null}
      trustedStanding={trustedStanding}
      initialPlan={effectivePlan}
      initialDateOfBirth={birthDetails?.dateOfBirth ?? ""}
      initialDateOfBirthCanCorrect={birthDetails?.canCorrect ?? true}
      initialBirthdayVisibility={fieldPrivacy?.birthday === "approved_muddies" ? "approved_muddies" : "only_me"}
      initialAgeVisibility={fieldPrivacy?.age === "approved_muddies" ? "approved_muddies" : "only_me"}
      initialZodiacVisibility={fieldPrivacy?.zodiac === "approved_muddies" ? "approved_muddies" : "only_me"}
      serverBirthdayDayKey={dateKeyInTimeZone(new Date(), DEFAULT_RECIPIENT_TIMEZONE)}
      birthdayPreview={birthdayPreview && !birthdayPrivacyDisabled}
      birthdayPrivacyDisabledPreview={birthdayPrivacyDisabled}
    />
  );
}
