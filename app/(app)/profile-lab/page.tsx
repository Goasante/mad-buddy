import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProfileVNextPage } from "@/components/profile/profile-vnext-page";
import { loadEffectivePlan } from "@/lib/billing/service";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import { dateKeyInTimeZone } from "@/lib/profile/birth-date";
import { loadDateOfBirthState } from "@/lib/profile/date-of-birth-service";
import { loadProfileIdentitySummary } from "@/lib/profile/identity-service";
import { loadVisibleProfilePhotosFor } from "@/lib/profile/photo-service";
import { profileCompletionPercent } from "@/lib/profile/rules";
import { loadFieldPrivacy } from "@/lib/profile/service";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile Lab",
  robots: { index: false, follow: false }
};

/**
 * Private production-domain proving ground for Profile VNext.
 *
 * The route deliberately reads the SAME canonical profile rows/services as
 * /profile. It adds no migration and owns no second copy of identity/privacy
 * state. The product owner can therefore judge the new information hierarchy
 * against real account data before the live profile is replaced.
 */
export default async function ProfileLabPage() {
  const labAccess = await getSafetyAdminContext();
  if (!labAccess.ok) redirect("/profile");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "full_name, username, bio, mood_status, avatar_url, visibility_status, trusted_member_since, institution, general_area"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const admin = createSupabaseAdminClient();
  const [plan, birthDetails, fieldPrivacy, identitySummary, photos, interestRows] = await Promise.all([
    loadEffectivePlan(admin, user.id),
    loadDateOfBirthState(user.id),
    loadFieldPrivacy(admin, user.id),
    loadProfileIdentitySummary(admin, user.id, "self"),
    loadVisibleProfilePhotosFor(admin, user.id, { isOwner: true, isApprovedMuddy: false }),
    admin.from("user_interests").select("interest").eq("user_id", user.id)
  ]);

  const interests = (interestRows.data ?? []).map((row) => row.interest);
  const completionInput = {
    hasDisplayName: Boolean(profile?.full_name?.trim()),
    hasUsername: Boolean(profile?.username?.trim()),
    hasPhoto: Boolean(profile?.avatar_url),
    hasBio: Boolean(profile?.bio?.trim()),
    hasInstitution: Boolean(profile?.institution?.trim()),
    hasInterests: interests.length > 0,
    hasFirstMuddy: (identitySummary?.activity?.muddyCount ?? 0) > 0
  };

  return (
    <>
      <nav className="mx-auto mb-4 flex w-full max-w-3xl flex-wrap items-center justify-center gap-2 px-1" aria-label="Profile Lab sections">
        <span className="rounded-full bg-[#4E0401] px-4 py-2 text-xs font-semibold text-white">Overview</span>
        <Link href="/profile-lab/edit" className="focus-ring rounded-full border border-border/70 bg-card px-4 py-2 text-xs font-semibold shadow-sm hover:bg-secondary">Edit Profile</Link>
        <Link href="/profile-lab/media" className="focus-ring rounded-full border border-border/70 bg-card px-4 py-2 text-xs font-semibold shadow-sm hover:bg-secondary">Media</Link>
        <Link href="/profile-lab/privacy" className="focus-ring rounded-full border border-border/70 bg-card px-4 py-2 text-xs font-semibold shadow-sm hover:bg-secondary">Privacy</Link>
        <Link href="/profile-lab/people" className="focus-ring rounded-full border border-border/70 bg-card px-4 py-2 text-xs font-semibold shadow-sm hover:bg-secondary">People preview</Link>
      </nav>
      <ProfileVNextPage
        displayName={profile?.full_name ?? user.user_metadata?.full_name ?? "Your name"}
        username={profile?.username ?? user.user_metadata?.username ?? "username"}
        bio={profile?.bio ?? ""}
        moodStatus={profile?.mood_status ?? ""}
        avatarUrl={profile?.avatar_url ?? null}
        visibilityStatus={profile?.visibility_status ?? "visible"}
        identitySummary={identitySummary}
        interests={interests}
        completion={{ percent: profileCompletionPercent(completionInput) }}
        generalArea={profile?.general_area ?? null}
        photos={photos}
        trustedSince={profile?.trusted_member_since ?? null}
        plan={plan}
        dateOfBirth={birthDetails?.dateOfBirth ?? ""}
        birthdayVisibility={fieldPrivacy?.birthday === "approved_muddies" ? "approved_muddies" : "only_me"}
        ageVisibility={fieldPrivacy?.age === "approved_muddies" ? "approved_muddies" : "only_me"}
        zodiacVisibility={fieldPrivacy?.zodiac === "approved_muddies" ? "approved_muddies" : "only_me"}
        serverBirthdayDayKey={dateKeyInTimeZone(new Date(), DEFAULT_RECIPIENT_TIMEZONE)}
      />
    </>
  );
}
