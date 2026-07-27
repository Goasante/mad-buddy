import { getVisibleHangoutsAction, type VisibleHangout } from "@/app/(app)/hangout-actions";
import {
  HangoutModePage,
  type ActiveHangout,
  type HangoutRequestSummary
} from "@/components/hangout/hangout-mode-page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function HangoutModeRoute() {
  const user = await getCurrentUser();

  const env = getSupabaseServerEnv();
  let activeHangout: ActiveHangout | null = null;
  let requests: HangoutRequestSummary[] = [];
  const feedPromise: Promise<VisibleHangout[]> = user
    ? getVisibleHangoutsAction()
    : Promise.resolve([]);

  if (user && env.url && env.serviceRoleKey) {
    const admin = createSupabaseAdminClient();
    const { data: session } = await admin
      .from("hangout_sessions")
      .select("id, activity_type, audience_type, message, ends_at, status")
      .eq("owner_id", user.id)
      .in("status", ["active", "paused", "full"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

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

  return <HangoutModePage initialActiveHangout={activeHangout} initialRequests={requests} initialFeed={feed} />;
}
