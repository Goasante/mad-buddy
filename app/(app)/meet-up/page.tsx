import { redirect } from "next/navigation";
import { getCurrentUserRecord } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { optionalFeatureEnabled } from "@/lib/features/availability-server";
import { LockedFeaturePreview } from "@/components/features/locked-feature-preview";
import { loadMeetups, loadMeetupMuddies } from "@/lib/meetups/arrangements";
import { MeetupPage } from "@/components/meetups/meetup-page";
import { guardAction } from "@/lib/admin/enforcement";
import { addMeetupProximity } from "@/lib/meetups/proximity";
import { saveMeetupAction } from "@/app/(app)/meetup-actions";

export const dynamic = "force-dynamic";
export default async function MeetupRoute({ searchParams }: { searchParams: Promise<{ meetup?: string }> }) {
  const user = await getCurrentUserRecord();
  if (!user) redirect("/login");
  if (!(await optionalFeatureEnabled("safe_arrival"))) return <LockedFeaturePreview feature="safe_arrival" />;
  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId: user.id, surface: "plans" });
  if (!guard.allowed) return <p role="alert">{guard.message}</p>;
  const [meetups, muddies, params] = await Promise.all([loadMeetups(admin, user.id), loadMeetupMuddies(admin, user.id), searchParams]);
  const withProximity = await addMeetupProximity(admin, user.id, meetups);
  return <MeetupPage viewerId={user.id} meetups={withProximity} muddies={muddies} focusedId={params.meetup} saveAction={saveMeetupAction} />;
}
