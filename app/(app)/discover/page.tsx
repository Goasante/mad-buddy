import {
  discoverSocializePeopleAction,
  getCurrentSocializeAction
} from "@/app/(app)/socialize-actions";
import { SocializePage } from "@/components/socialize/socialize-page";
import { loadGroupsPageDataAction } from "@/app/(app)/group-actions";
import { loadUpcomingPlans } from "@/lib/social/upcoming-plans";
import { isSocializeEnabled } from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** A status row exists until it expires; the column is the only authority. */
function isStatusActiveAtRequestTime(expiresAt: string) {
  return Date.parse(expiresAt) > Date.now();
}

export default async function DiscoverPage() {
  const admin = createSupabaseAdminClient();
  if (!(await isSocializeEnabled(admin))) redirect("/dashboard");

  const user = await getCurrentUser();
  // Quick Controls needs the same own-profile and status rows Home reads, so
  // the sheet opens on this page showing the user's real state rather than a
  // default. Own rows only, read with the admin client exactly as Home does.
  const [profileResult, statusResult, session] = await Promise.all([
    user
      ? admin
          .from("profiles")
          .select("full_name, avatar_url, visibility_status")
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    user
      ? admin
          .from("user_statuses")
          .select("availability_type, activity_type, custom_text, expires_at")
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getCurrentSocializeAction()
  ]);

  const status = statusResult?.data;
  const hasActiveStatus = Boolean(status && isStatusActiveAtRequestTime(status.expires_at));
  const people = session ? await discoverSocializePeopleAction() : [];
  // Groups and plans for the discovery rails. Both reuse EXISTING
  // projections, loaded in parallel with each other rather than in series.
  const [groupsData, plansData] = await Promise.all([
    loadGroupsPageDataAction(),
    user ? loadUpcomingPlans(user.id, 3) : Promise.resolve({ plans: [], hasMore: false })
  ]);

  return (
    <SocializePage
      initialSession={session}
      initialPeople={people}
      initialGroups={groupsData.discoverableGroups}
      initialPlans={plansData.plans}
      myAvatarUrl={profileResult.data?.avatar_url ?? null}
      myName={profileResult.data?.full_name?.trim() ?? ""}
      initialVisibilityStatus={profileResult.data?.visibility_status ?? "visible"}
      hasActiveStatus={hasActiveStatus}
      initialStatusAvailability={hasActiveStatus ? status?.availability_type : undefined}
      initialStatusActivity={hasActiveStatus ? status?.activity_type ?? null : null}
      initialStatusNote={hasActiveStatus ? status?.custom_text ?? "" : ""}
    />
  );
}
