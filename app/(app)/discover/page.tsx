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

export default async function DiscoverPage() {
  const admin = createSupabaseAdminClient();
  if (!(await isSocializeEnabled(admin))) redirect("/dashboard");

  const user = await getCurrentUser();
  const [profileResult, session] = await Promise.all([
    user
      ? admin.from("profiles").select("full_name, avatar_url").eq("user_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    getCurrentSocializeAction()
  ]);
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
    />
  );
}
