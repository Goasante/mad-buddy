import { getVisibleHangoutsAction, type VisibleHangout } from "@/app/(app)/hangout-actions";
import {
  HangoutModePage,
  type ActiveHangout,
  type HangoutRequestSummary
} from "@/components/hangout/hangout-mode-page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/auth";
import { currentActiveHangout } from "@/lib/social/planning";

export const dynamic = "force-dynamic";

export default async function HangoutModeRoute() {
  const user = await getCurrentUser();

  const env = getSupabaseServerEnv();
  let activeHangout: ActiveHangout | null = null;
  let requests: HangoutRequestSummary[] = [];
  let avatarUrl: string | null = null;
  let displayName = "";
  let muddyCount = 0;
  const feedPromise: Promise<VisibleHangout[]> = user
    ? getVisibleHangoutsAction()
    : Promise.resolve([]);

  if (user && env.url && env.serviceRoleKey) {
    const admin = createSupabaseAdminClient();

    const [{ data: profile }, muddies] = await Promise.all([
      admin.from("profiles").select("full_name, avatar_url").eq("user_id", user.id).maybeSingle(),
      admin
        .from("friendships")
        .select("user_one_id", { count: "exact", head: true })
        .or(`user_one_id.eq.${user.id},user_two_id.eq.${user.id}`)
        .is("ended_at", null)
        .then((result) => result.count ?? 0)
    ]);
    avatarUrl = profile?.avatar_url ?? null;
    displayName = profile?.full_name?.trim() ?? "";
    muddyCount = muddies;

    // Canonical, server-authoritative resolve: sweeps expired sessions and
    // returns the single genuinely-active one (or null). A reopen never shows a
    // stale ACTIVE, and expired rows stop counting toward the active limit.
    const session = await currentActiveHangout(admin, user.id);

    if (session) {
      activeHangout = {
        id: session.id,
        activityType: session.activity_type,
        audienceType: session.audience_type,
        message: session.message,
        endsAt: session.ends_at
      };

      const { data: requestRows } = await admin
        .from("hangout_requests")
        .select("id, requester_id, status, message, created_at")
        .eq("hangout_session_id", session.id)
        .order("created_at", { ascending: true });

      const requesterIds = [...new Set((requestRows ?? []).map((row) => row.requester_id))];
      const nameById = new Map<string, string>();
      if (requesterIds.length > 0) {
        const { data: profiles } = await admin
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", requesterIds);
        for (const profile of profiles ?? []) {
          nameById.set(profile.user_id, profile.full_name?.trim() || "A Muddy");
        }
      }

      requests = (requestRows ?? []).map((row) => ({
        id: row.id,
        requesterName: nameById.get(row.requester_id) ?? "A Muddy",
        status: row.status,
        message: row.message
      }));
    }
  }

  const feed = await feedPromise;

  return (
    <HangoutModePage
      initialActiveHangout={activeHangout}
      initialRequests={requests}
      initialFeed={feed}
      avatarUrl={avatarUrl}
      displayName={displayName}
      muddyCount={muddyCount}
      viewerId={user?.id ?? null}
    />
  );
}
