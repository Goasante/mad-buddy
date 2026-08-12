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
import { canEnterEventMode, readEventModeContext } from "@/lib/social/event-mode";
import { liveCheckIn } from "@/lib/events/service";

export const dynamic = "force-dynamic";

/** A status row exists until it expires; the column is the only authority. */
function isStatusActiveAtRequestTime(expiresAt: string) {
  return Date.parse(expiresAt) > Date.now();
}

/**
 * Linkr Event Mode (Stage F), resolved SERVER-SIDE.
 *
 * The URL is a request, never an authorisation: canEnterEventMode is
 * re-checked here against a real live check-in row, so hand-typing the link
 * without having checked in gets ordinary Linkr rather than event context.
 * Returns only a NAME -- a label for the banner. No discovery parameter is
 * altered and nothing is stored, so leaving this URL leaves the mode.
 */
async function resolveEventModeName(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string | null,
  eventId: string | null
): Promise<string | null> {
  if (!eventId || !userId) return null;

  const [{ data: eventRow }, checkIn] = await Promise.all([
    admin.from("events").select("id, name, status, ends_at").eq("id", eventId).maybeSingle(),
    liveCheckIn(admin, userId, "event", eventId)
  ]);

  const eventActive = Boolean(
    eventRow &&
      eventRow.status !== "cancelled" &&
      eventRow.status !== "draft" &&
      Date.parse(eventRow.ends_at) > Date.now()
  );
  if (!canEnterEventMode({ viewerCheckedIn: Boolean(checkIn), eventActive, accessDenied: false })) {
    return null;
  }
  return eventRow?.name ?? null;
}

export default async function DiscoverPage({
  searchParams
}: {
  searchParams: Promise<{ eventMode?: string; eventId?: string }>;
}) {
  const admin = createSupabaseAdminClient();
  if (!(await isSocializeEnabled(admin))) redirect("/dashboard");

  const user = await getCurrentUser();

  /**
   * Linkr Event Mode (Stage F), resolved SERVER-SIDE.
   *
   * The URL is a request, never an authorisation: canEnterEventMode is
   * re-checked here against a real live check-in row, so hand-typing the link
   * without having checked in gets ordinary Linkr rather than event context.
   * Nothing is stored -- leaving this URL leaves the mode.
   */
  const params = await searchParams;
  const requestedEventMode = readEventModeContext({
    eventMode: params.eventMode ?? null,
    eventId: params.eventId ?? null
  });
  const eventModeName = await resolveEventModeName(
    admin,
    user?.id ?? null,
    requestedEventMode?.eventId ?? null
  );
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
    user ? loadUpcomingPlans(user.id, 8) : Promise.resolve({ plans: [], hasMore: false })
  ]);

  return (
    <SocializePage
      // Context only: the banner explains why Linkr opened differently. It
      // does not widen eligibility, and it is not persisted anywhere.
      eventModeName={eventModeName}
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
