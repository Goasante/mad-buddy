import { MomentsPage } from "@/components/content/moments-page";
import type { MomentMuddyOption } from "@/components/content/moment-composer";
import { checkFeature } from "@/lib/billing/entitlements";
import { resolveUserEntitlements } from "@/lib/billing/service";
import { buildMomentFeed, buildSpotlightFeed } from "@/lib/content/service";
import { isOpenMomentsEnabled } from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function MomentsRoute({
  searchParams
}: {
  searchParams: Promise<{ feed?: string; author?: string; create?: string }>;
}) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const requestedFeed = query.feed === "air" ? "spotlight" : "moments";
  const requestedAuthor = query.author?.trim() || null;
  const requestedCreate = query.create === "1";

  const env = getSupabaseServerEnv();
  if (!user || !env.url || !env.serviceRoleKey) {
    return (
      <MomentsPage
        initialMoments={[]}
        initialOpenMoments={[]}
        muddies={[]}
        initialFeed={requestedFeed}
        initialAuthorId={requestedAuthor}
        initiallyCreating={requestedCreate}
      />
    );
  }

  const admin = createSupabaseAdminClient();
  const [moments, muddies, spotlightEnabled, entitlements, profile, closeFriends] = await Promise.all([
    buildMomentFeed(admin, user.id),
    loadMuddies(admin, user.id),
    isOpenMomentsEnabled(admin),
    resolveUserEntitlements(admin, user.id),
    admin.from("profiles").select("full_name, avatar_url").eq("user_id", user.id).maybeSingle(),
    admin.from("close_friend_relationships").select("id", { count: "exact", head: true }).eq("owner_id", user.id)
  ]);
  const spotlight = spotlightEnabled ? await buildSpotlightFeed(admin, user.id) : [];

  return (
    <MomentsPage
      initialMoments={moments}
      initialOpenMoments={spotlight}
      muddies={muddies}
      openMomentsEnabled={spotlightEnabled}
      // Resolved on the SERVER through the canonical entitlement, honouring admin
      // tier/user overrides and billing grace. The client is told the answer and
      // never trusted to compute it; the create action re-checks it regardless.
      canPublishOpenMoments={checkFeature(entitlements, "public_moments")}
      viewerName={profile.data?.full_name?.trim() || "You"}
      viewerAvatarUrl={profile.data?.avatar_url ?? null}
      // Close Friends is only offered when the viewer actually has some, so the
      // audience list never shows an option that would reach nobody.
      closeFriendsAvailable={(closeFriends.count ?? 0) > 0}
      initialFeed={requestedFeed}
      initialAuthorId={requestedAuthor}
      initiallyCreating={requestedCreate}
    />
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
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`),
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
