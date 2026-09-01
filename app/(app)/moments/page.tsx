import { Suspense } from "react";
import { MomentsPage } from "@/components/content/moments-page";
import type { MomentMuddyOption } from "@/components/content/moment-composer";
import { buildMomentFeed, buildSpotlightFeed } from "@/lib/content/service";
import { redirect } from "next/navigation";
import { isMomentsEnabled, isOpenMomentsEnabled } from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/auth";
import { dateKeyInTimeZone, isBirthdayOnDate } from "@/lib/profile/birth-date";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";

export const dynamic = "force-dynamic";

export default async function MomentsRoute({
  searchParams
}: {
  searchParams?: Promise<{ birthdayPreview?: string }>;
}) {
  const previewParams = await searchParams;
  const birthdayPreview = process.env.NODE_ENV !== "production" && previewParams?.birthdayPreview === "1";
  const user = await getCurrentUser();

  const env = getSupabaseServerEnv();
  if (!user || !env.url || !env.serviceRoleKey) {
    return (
      <Suspense fallback={null}>
        <MomentsPage initialMoments={[]} initialOpenMoments={[]} muddies={[]} />
      </Suspense>
    );
  }

  const admin = createSupabaseAdminClient();

  // Moments paused. Same shape as the Socialize guard on /discover: a direct
  // URL lands on Home rather than a blank or broken surface, which is also
  // what makes historical `moment:` notifications safe to leave in place.
  if (!(await isMomentsEnabled(admin))) redirect("/dashboard");

  const [moments, muddies, spotlightEnabled, profile, closeFriends, birthDetails] = await Promise.all([
    buildMomentFeed(admin, user.id),
    loadMuddies(admin, user.id),
    isOpenMomentsEnabled(admin),
    admin.from("profiles").select("full_name, avatar_url").eq("user_id", user.id).maybeSingle(),
    admin.from("close_friend_relationships").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
    admin.from("profile_birth_details").select("date_of_birth").eq("user_id", user.id).maybeSingle()
  ]);
  const spotlight = spotlightEnabled ? await buildSpotlightFeed(admin, user.id) : [];

  return (
    <Suspense fallback={null}>
    <MomentsPage
      initialMoments={moments}
      initialOpenMoments={spotlight}
      muddies={muddies}
      openMomentsEnabled={spotlightEnabled}
      viewerName={profile.data?.full_name?.trim() || "You"}
      viewerAvatarUrl={profile.data?.avatar_url ?? null}
      // Close Friends is only offered when the viewer actually has some, so the
      // audience list never shows an option that would reach nobody.
      closeFriendsAvailable={(closeFriends.count ?? 0) > 0}
      birthdayTemplateAvailable={birthdayPreview || Boolean(
        birthDetails.data?.date_of_birth &&
          isBirthdayOnDate(
            birthDetails.data.date_of_birth,
            dateKeyInTimeZone(new Date(), DEFAULT_RECIPIENT_TIMEZONE)
          )
      )}
    />
    </Suspense>
  );
}

/** Approved, unblocked Muddies: the canonical audience source for a Moment. */
async function loadMuddies(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
): Promise<MomentMuddyOption[]> {
  const [{ data: friendships }, { data: blocks }] = await Promise.all([
    admin
      .from("friendships")
      .select("user_one_id, user_two_id")
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
      .is("ended_at", null),
    admin
      .from("blocked_users")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)
  ]);

  const blockedIds = new Set(
    (blocks ?? []).map((row) => (row.blocker_id === userId ? row.blocked_id : row.blocker_id))
  );
  const friendIds = [
    ...new Set((friendships ?? []).map((row) => (row.user_one_id === userId ? row.user_two_id : row.user_one_id)))
  ].filter((id) => id !== userId && !blockedIds.has(id));
  if (friendIds.length === 0) return [];

  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, full_name, avatar_url")
    .in("user_id", friendIds);

  return (profiles ?? [])
    .map((profile) => ({
      id: profile.user_id,
      name: profile.full_name?.trim() || "A Muddy",
      avatarUrl: profile.avatar_url
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
