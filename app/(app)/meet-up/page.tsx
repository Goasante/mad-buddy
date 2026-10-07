import { redirect } from "next/navigation";
import { getCurrentUserRecord } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { optionalFeatureEnabled } from "@/lib/features/availability-server";
import { LockedFeaturePreview } from "@/components/features/locked-feature-preview";
import { loadMeetups, loadMeetupMuddies } from "@/lib/meetups/arrangements";
import { MeetupPage } from "@/components/meetups/meetup-page";
import { guardAction } from "@/lib/admin/enforcement";
import { saveMeetupAction } from "@/app/(app)/meetup-actions";
import { createMeetupDiscoveryAction, updateMeetupDiscoveryAction } from "@/app/(app)/meetup-discovery-actions";
import { loadMeetupDiscoveryHub } from "@/lib/meetups/discovery-service";

export const dynamic = "force-dynamic";

function currentServerTimeMs() {
  return Date.now();
}
export default async function MeetupRoute({ searchParams }: { searchParams: Promise<{ meetup?: string; newPeople?: string }> }) {
  const user = await getCurrentUserRecord();
  if (!user) redirect("/login");
  if (!(await optionalFeatureEnabled("safe_arrival"))) return <LockedFeaturePreview feature="safe_arrival" />;
  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId: user.id, surface: "plans" });
  if (!guard.allowed) return <p role="alert">{guard.message}</p>;
  const [meetups, muddies, discoveryHub, params] = await Promise.all([
    loadMeetups(admin, user.id),
    loadMeetupMuddies(admin, user.id),
    loadMeetupDiscoveryHub(user.id),
    searchParams
  ]);
  return (
    <MeetupPage
      viewerId={user.id}
      meetups={meetups}
      muddies={muddies}
      focusedId={params.meetup}
      openNewPeople={params.newPeople === "1"}
      discoveryHub={discoveryHub}
      discoveryAction={async (input, create = false) => create ? createMeetupDiscoveryAction(input) : updateMeetupDiscoveryAction(input)}
      saveAction={saveMeetupAction}
      initialNowMs={currentServerTimeMs()}
    />
  );
}
