import { DashboardPageContent } from "@/components/dashboard/dashboard-page";
import { loadFriendGlowColors } from "@/lib/glow/custom-colors-server";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { ensureProfileForUser } from "@/lib/profiles/ensure-profile";
import { loadSafeArrivalJourneys } from "@/lib/safety/safe-arrival-service";
import { loadUpcomingPlans } from "@/lib/social/upcoming-plans";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSocializeEnabled } from "@/lib/features/feature-flags";
import { loadJourney } from "@/lib/journey/journey-service";

function isStatusActiveAtRequestTime(expiresAt: string) {
  return Date.parse(expiresAt) > Date.now();
}

export default async function DashboardPage() {
  // Shares the per-request cached getUser() with the layout; the client is for
  // this page's own queries.
  const [supabase, user] = await Promise.all([createSupabaseServerClient(), getCurrentUser()]);
  const admin = createSupabaseAdminClient();
  const [access, profile, statusResult, upcoming, profileDetailsResult, safeArrival, glowColorByFriendId, socializeEnabled, journey] = user
    ? await Promise.all([
        getCurrentSubscriptionAccess(user.id),
        ensureProfileForUser(user),
        supabase
          .from("user_statuses")
          .select("availability_type, activity_type, custom_text, expires_at")
          .eq("user_id", user.id)
          .maybeSingle(),
        loadUpcomingPlans(user.id),
        supabase
          .from("profiles")
          .select("avatar_url, bio, mood_status")
          .eq("user_id", user.id)
          .maybeSingle(),
        loadSafeArrivalJourneys(admin, user.id),
        loadFriendGlowColors(admin, user.id),
        isSocializeEnabled(admin),
        loadJourney(admin, user.id)
      ])
    : [null, null, null, { plans: [], hasMore: false }, null, null, {}, false, null];

  const status = statusResult?.data;
  const hasActiveStatus = Boolean(status && isStatusActiveAtRequestTime(status.expires_at));
  const profileDetails = profileDetailsResult?.data;
  const missingProfileItems = profileDetails
    ? [
        !profileDetails.avatar_url ? "photo" : null,
        !profileDetails.bio?.trim() ? "short bio" : null,
        !profileDetails.mood_status?.trim() ? "mood" : null
      ].filter((item): item is string => Boolean(item))
    : [];

  return (
    <DashboardPageContent
      subscriptionPlan={access?.plan}
      hasPremium={access?.hasPremium}
      initialVisibilityStatus={profile?.visibility_status ?? "visible"}
      displayName={profile?.full_name?.split(" ")[0] || ""}
      hasActiveStatus={hasActiveStatus}
      initialStatusAvailability={hasActiveStatus ? status?.availability_type : undefined}
      initialStatusActivity={hasActiveStatus ? status?.activity_type ?? null : null}
      initialStatusNote={hasActiveStatus ? status?.custom_text ?? "" : ""}
      upcomingPlans={upcoming?.plans ?? []}
      hasMorePlans={upcoming?.hasMore ?? false}
      glowColorByFriendId={glowColorByFriendId}
      safeArrival={
        safeArrival
          ? {
              travelling: safeArrival.travelling,
              // Accepted only: an unanswered invite belongs in `invitations`,
              // where it is still actionable, not in the accepted list.
              checkingOn: safeArrival.checkingOn.filter((journey) => journey.myAcknowledgement === "accepted"),
              invitations: safeArrival.checkingOn.filter((journey) => journey.myAcknowledgement === "invited")
            }
          : null
      }
      profileReminder={
        user && missingProfileItems.length > 0
          ? { userId: user.id, missingItems: missingProfileItems }
          : null
      }
      hiddenQuickActionHrefs={socializeEnabled ? [] : ["/discover"]}
      journey={journey}
    />
  );
}
