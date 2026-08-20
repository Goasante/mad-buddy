import { ProfilePageContent } from "@/components/profile/profile-page";
import { isMomentsEnabled } from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadEffectivePlan } from "@/lib/billing/service";
import { loadFieldPrivacy } from "@/lib/profile/service";
import { loadDateOfBirthState } from "@/lib/profile/date-of-birth-service";
import { dateKeyInTimeZone } from "@/lib/profile/birth-date";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import { loadProfileIdentitySummary } from "@/lib/profile/identity-service";
import { loadVisibleProfilePhotosFor } from "@/lib/profile/photo-service";
import { getTrustedMemberStandingAction } from "@/app/(app)/trusted-member-actions";
import { loadJourney } from "@/lib/journey/journey-service";
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
        .select("full_name, username, bio, mood_status, avatar_url, visibility_status, trusted_member_since")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  const admin = createSupabaseAdminClient();
  const [effectivePlan, birthDetails, fieldPrivacy, identitySummary, journey, photos, trustedStanding, momentsEnabled] = user
    ? await Promise.all([
        loadEffectivePlan(admin, user.id),
        loadDateOfBirthState(user.id),
        loadFieldPrivacy(admin, user.id),
        loadProfileIdentitySummary(admin, user.id, "self"),
        loadJourney(admin, user.id),
        // The owner sees every photo, including only_me — a photo you cannot
        // see is a photo you cannot manage. Loaded here in the same parallel
        // batch rather than as a follow-up request.
        loadVisibleProfilePhotosFor(admin, user.id, { isOwner: true, isApprovedMuddy: false }),
        getTrustedMemberStandingAction(),
        isMomentsEnabled(admin)
      ])
    : ["free" as const, null, null, null, null, [], null, false];

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
      momentsEnabled={momentsEnabled}
      journey={journey}
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
